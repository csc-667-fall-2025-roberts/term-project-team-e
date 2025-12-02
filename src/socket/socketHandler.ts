// 
import { Server, Socket } from 'socket.io';
import { query } from '../db/database';
import { ServerToClientEvents, ClientToServerEvents } from '../types';

export function setupSocketHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>) {
    io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
        console.log('User connected:', socket.id);

        const session = (socket.request as any).session;

        if (!session || !session.userId) {
            console.log('Unauthorized socket connection');
            socket.disconnect();
            return;
        }

        const userId = session.userId;
        const username = session.username;

        // show lobby room if user joins
        socket.on('lobby:join', async () => {
            try {
                socket.join('lobby');
                console.log(`${username} joined lobby`);

                // Broadcast updated game list to lobby
                await broadcastGameList(io);
            } catch (error) {
                console.error('Lobby join error:', error);
                socket.emit('error', 'Failed to join lobby');
            }
        });

        // Leave lobby
        socket.on('lobby:leave', () => {
            socket.leave('lobby');
            console.log(`${username} left the lobby`);
        });

        // ability to send lobby chat message
        socket.on('lobby:chat:send', async (message: string) => {
            try {
                if (!message || message.trim().length === 0) {
                    return;
                }

                // edge case: too long
                if (message.length > 500) {
                    socket.emit('error', 'Message is too long');
                    return;
                }

                // 
                const result = await query(
                    'INSERT INTO lobby_chat (user_id, message) VALUES ($1, $2) RETURNING message_id, created_at',
                    [userId, message.trim()]
                );

                const messageData = {
                    message_id: result.rows[0].message_id,
                    user_id: userId,
                    username: username,
                    message: message.trim(),
                    created_at: result.rows[0].created_at
                };

                
                io.to('lobby').emit('lobby:chat:message', messageData);
            } catch (error) {
                console.error('Lobby chat error:', error);
                socket.emit('error', 'Failed to send message');
            }
        });

        // Join game room; TODO, need to add a specific waiting:join for waiting room, becuase now its using game:join
        socket.on('game:join', async (gameId: number) => {
            try {
                // Is participant?
                const part = await query(
                    'SELECT participant_id FROM game_participants WHERE game_id = $1 AND user_id = $2',
                    [gameId, userId]
                );

                let isParticipant = part.rows.length > 0;

                // If not participant, allow spectators only when playing
                if (!isParticipant) {
                    const g = await query('SELECT status FROM games WHERE game_id = $1', [gameId]);
                    if (g.rows.length === 0) {
                        socket.emit('error', 'Game not found');
                        return;
                    }

                    const canSpectate = g.rows[0].status === 'playing' || g.rows[0].status === 'results';

                    if (!canSpectate) {
                        socket.emit('error', 'You are not in this game');
                        return;
                    }
                }

                socket.join(`game:${gameId}`);
                console.log(`${username} joined game ${gameId} (${isParticipant ? 'player' : 'spectator'})`);

                // Only announce "player joined" for participants
                if (isParticipant) {
                    io.to(`game:${gameId}`).emit('game:player:joined', {
                        user_id: userId,
                        username: username,
                        player_order: 0,
                        is_active: true
                    });
                }

                // Ask clients to refetch (safe “dirty” signal approach)
                await broadcastGameState(io, gameId);
            } catch (error) {
                console.error('Game join error:', error);
                socket.emit('error', 'Failed to join game');
            }
        });


        //leave game room; TOODO, need to add a specific waiting:leave for waiting room, becuase now its using game:leave
        socket.on('game:leave', (gameId: number) => {
            socket.leave(`game:${gameId}`);
            console.log(`${username} left game ${gameId}`);
        });

        // 
        socket.on('game:chat:send', async ({ gameId, message }) => {
            try {
                if (!message || message.trim().length === 0) {
                    return;
                }

                if (message.length > 500) {
                    socket.emit('error', 'Message is too long');
                    return;
                }

                const participantCheck = await query(
                    'SELECT participant_id FROM game_participants WHERE game_id = $1 AND user_id = $2 AND is_active = true',
                    [gameId, userId]
                );

                if (participantCheck.rows.length === 0) {
                    socket.emit('error', 'You are not in this game');
                    return;
                }

                // get the rounds and then current_round
                const r = await query('SELECT current_round FROM games WHERE game_id = $1', [gameId]);
                const round = r.rows[0].current_round;

                const result = await query(
                    'INSERT INTO game_chat (game_id, user_id, message, round_number) VALUES ($1, $2, $3, $4) RETURNING message_id, created_at',
                    [gameId, userId, message.trim(), round]
                );


                const messageData = {
                    message_id: result.rows[0].message_id,
                    game_id: gameId,
                    user_id: userId,
                    username: username,
                    message: message.trim(),
                    created_at: result.rows[0].created_at
                };

                io.to(`game:${gameId}`).emit('game:chat:message', messageData);
            } catch (error) {
                console.error('Game chat error:', error);
                socket.emit('error', 'Failed to send message');
            }
        });

        //for waiting room chat
        socket.on('waiting:chat:send', async ({ gameId, message }) => {
            try {
                if (!message || message.trim().length === 0) return;
                if (message.length > 500) {
                    socket.emit('error', 'Message is too long');
                    return;
                }

                // Save to DB
                const result = await query(
                    `INSERT INTO waiting_room_chat (game_id, user_id, message)
                    VALUES ($1, $2, $3)
                    RETURNING message_id, created_at`,
                    [gameId, userId, message.trim()]
                );

                const msg = {
                    message_id: result.rows[0].message_id,
                    game_id: gameId,
                    user_id: userId,
                    username,
                    message: message.trim(),
                    created_at: result.rows[0].created_at
                };

                // Broadcast to everyone in waiting room
                io.to(`game:${gameId}`).emit('waiting:chat:message', msg);

            } catch (err) {
                console.error('Waiting room chat error:', err);
                socket.emit('error', 'Failed to send waiting room chat');
            }
        });


        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
        });
    });
}

// Helper function to broadcast game list to lobby
export async function broadcastGameList(io: Server<ClientToServerEvents, ServerToClientEvents>) {
    try {

        const result = await query(`
            SELECT 
                g.game_id,
                g.game_name,
                g.status,
                g.host_user_id,
                g.join_mode,              
                u.username as host_username,
                COUNT(gp.participant_id) as player_count
            FROM games g
            JOIN users u ON g.host_user_id = u.user_id
            LEFT JOIN game_participants gp ON g.game_id = gp.game_id AND gp.is_active = true
            WHERE g.status IN ('waiting','playing','results')               
            GROUP BY g.game_id, g.game_name, g.status, g.host_user_id, g.join_mode, u.username
            ORDER BY g.created_at DESC
        `);

        const games = result.rows.map((row: any) => ({
            game_id: row.game_id,
            game_name: row.game_name,
            host_username: row.host_username,
            status: row.status,
            player_count: parseInt(row.player_count),
            can_join: row.status === 'waiting',
            can_spectate: row.status === 'playing' || row.status === 'results',
            is_participant: false,
            requires_code: row.join_mode === 'code'
        }));

        // Emit to all 
        io.to('lobby').emit('lobby:games:update', games);
    } catch (error) {
        console.error('Broadcast game list error:', error);
    }
}

export async function broadcastGameState(io: Server<ClientToServerEvents, ServerToClientEvents>, gameId: number) {
    try {
        io.to(`game:${gameId}`).emit('game:state:dirty'); 
    } catch (error) {
        console.error('Broadcast game state error:', error);
    }
}
