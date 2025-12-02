
import express, { Request, Response } from 'express';
import { query, getClient } from '../db/database';
import { requireAuth } from '../middleware/auth';
import {
    CreateGameRequest,
    JoinGameRequest,
    PlayCardRequest,
    GameListItem,
    GameState,
    PlayerCard
} from '../types';
import {
    createDeck,
    shuffleDeck,
    dealInitialCards,
    getNextPlayerId,
    calculateScore,
    areAllCardsFaceUp,
    isValidMove
} from '../utils/gameLogic';
import * as crypto from 'crypto';
import { PoolClient } from 'pg'; 

const router = express.Router();



async function seedNewRoundState(
    client: PoolClient,
    gameId: number,
    participants: Array<{ user_id: number; player_order: number }>
) {
    // 1. Build & shuffle deck based on player count
    const deck = shuffleDeck(createDeck(participants.length));

    // 2. Deal initial hands
    const { playerCards, remainingDeck } = dealInitialCards(deck, participants.length);

    // 3. Insert hands into player_cards
    for (let i = 0; i < participants.length; i++) {
        const cards = playerCards[i];
        const uid = participants[i].user_id;

        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 3; col++) {
                const cardIndex = row * 3 + col;
                await client.query(
                    `INSERT INTO player_cards (
                        game_id, user_id, card_value, position_row, position_col, is_face_up
                    ) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [gameId, uid, cards[cardIndex], row, col, false]
                );
            }
        }
    }

    // 4. Fill draw_pile with remaining deck
    for (let i = 0; i < remainingDeck.length; i++) {
        await client.query(
            'INSERT INTO draw_pile (game_id, card_value, position_in_pile) VALUES ($1, $2, $3)',
            [gameId, remainingDeck[i], i]
        );
    }

    // 5. Move top card of draw pile into discard_pile
    const firstDiscardCard = remainingDeck[remainingDeck.length - 1];
    await client.query(
        'INSERT INTO discard_pile (game_id, card_value) VALUES ($1, $2)',
        [gameId, firstDiscardCard]
    );

    await client.query(
        'DELETE FROM draw_pile WHERE game_id = $1 AND position_in_pile = $2',
        [gameId, remainingDeck.length - 1]
    );
}


function hashCode(code: string) {

    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(code, salt, 32);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyCode(code: string, stored?: string | null) {
    if (!stored) return false;
    const [method, hexSalt, hexHash] = stored.split('$');
    if (method !== 'scrypt' || !hexSalt || !hexHash) return false;
    const salt = Buffer.from(hexSalt, 'hex');
    const expected = Buffer.from(hexHash, 'hex');
    const actual = crypto.scryptSync(code, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
}


// Get: list of games to be displayed in lobby
router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;

        // gp_active = active participants
        const result = await query(`
            SELECT 
                g.game_id,
                g.game_name,
                g.status,
                g.host_user_id,
                g.join_mode,
                u.username AS host_username,
                COUNT(gp_active.participant_id) AS player_count,
                -- active membership for this user
                MAX(CASE WHEN gp_me.user_id = $1 AND gp_me.is_active = true  THEN 1 ELSE 0 END) AS is_participant,
                -- inactive prior membership for this user (we won't "resume game", but we may treat waiting as fresh join)
                MAX(CASE WHEN gp_me.user_id = $1 AND gp_me.is_active = false THEN 1 ELSE 0 END) AS was_participant_inactive
            FROM games g
            JOIN users u ON g.host_user_id = u.user_id
            LEFT JOIN game_participants gp_active 
                ON g.game_id = gp_active.game_id AND gp_active.is_active = true
            LEFT JOIN game_participants gp_me 
                ON g.game_id = gp_me.game_id AND gp_me.user_id = $1

            WHERE g.status IN ('waiting', 'playing', 'results')

            GROUP BY g.game_id, g.game_name, g.status, g.host_user_id, g.join_mode, u.username

            ORDER BY g.created_at DESC
        `, [userId]);

        const games = result.rows.map(row => {
            const is_participant = row.is_participant === 1;
            const was_inactive = row.was_participant_inactive === 1;


            const can_join = row.status === 'waiting' && !is_participant;
            const can_spectate = (row.status === 'playing' || row.status === 'results') && !is_participant;


            return {
                game_id: row.game_id,
                game_name: row.game_name,
                host_username: row.host_username,
                status: row.status,
                player_count: parseInt(row.player_count, 10),

                
                is_participant,
                can_join,
                can_spectate,

                can_resume_waiting: false, 
                can_resume_game: false,    

                requires_code: row.join_mode === 'code',

            };
        });

        res.json({ games });
    } catch (error) {
        console.error('Get games error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Create: create a new game
router.post('/', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;

        const { game_name, join_mode = 'open', join_code } = req.body as CreateGameRequest;

        if (!game_name || game_name.trim().length === 0) {
            return res.status(400).json({ error: 'Game name is required' });
        }
        if (join_mode !== 'open' && join_mode !== 'code') {
            return res.status(400).json({ error: 'Invalid join mode' });
        }
        if (join_mode === 'code' && (!join_code || join_code.trim().length < 4)) {
            return res.status(400).json({ error: 'Code must be at least 4 characters' });
        }


        
        const activeGame = await query(`
            SELECT gp.game_id 
            FROM game_participants gp
            JOIN games g ON gp.game_id = g.game_id
            WHERE gp.user_id = $1 AND gp.is_active = true AND g.status IN ('waiting', 'playing')
        `, [userId]);

        if (activeGame.rows.length > 0) {
            return res.status(409).json({ error: 'You are already in an active game' });
        }

        const client = await getClient();

        try {
            await client.query('BEGIN');

            console.log('create game payload', { game_name, join_mode, hasJoinCode: !!join_code });


            const codeHash = join_mode === 'code' ? hashCode(join_code!.trim()) : null;

            const gameResult = await client.query(
                `INSERT INTO games (
                    game_name, host_user_id, status, join_mode, join_code_hash, join_code_set_at
                    )
                    VALUES (
                    $1::varchar(100),
                    $2::int,
                    $3::varchar(20),
                    $4::varchar(10),
                    $5::varchar(255),
                    CASE WHEN $5 IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
                    )
                    RETURNING game_id`,
                [game_name.trim(), userId, 'waiting', join_mode, codeHash]
            );




            const gameId = gameResult.rows[0].game_id;

            
            await client.query(
                'INSERT INTO game_participants (game_id, user_id, player_order) VALUES ($1, $2, $3)',
                [gameId, userId, 0]
            );

            await client.query('COMMIT');

            try {
                const io = req.app.get('io');
                const broadcastGameList = req.app.get('broadcastGameList');
                await broadcastGameList(io);
            } catch (e) {
                console.error('Broadcast new game failed:', e);
            }

            res.status(201).json({
                message: 'Game created successfully',
                game_id: gameId
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Create game error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


router.post('/:gameId/join', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

        
        const gameResult = await query(
            'SELECT game_id, status, join_mode, join_code_hash FROM games WHERE game_id = $1',
            [gameId]
        );
        if (gameResult.rows.length === 0) return res.status(404).json({ error: 'Game not found' });

        const game = gameResult.rows[0] as {
            game_id: number;
            status: 'waiting' | 'playing' | 'ended';
            join_mode: 'open' | 'code' | null;
            join_code_hash: string | null;
        };

        
        const kicked = await query(
            'SELECT 1 FROM game_kicks WHERE game_id = $1 AND user_id = $2',
            [gameId, userId]
        );
        if (kicked.rows.length > 0) {
            return res.status(403).json({ error: 'You were removed by the host and cannot rejoin this waiting room.' });
        }


        const mePart = await query(
            'SELECT participant_id, is_active FROM game_participants WHERE game_id = $1 AND user_id = $2',
            [gameId, userId]
        );

        if (mePart.rows.length > 0) {
            const { is_active } = mePart.rows[0];

            if (is_active) {
                return res.status(409).json({ error: 'You are already in this game' });
            }

            // 
            if (game.status === 'ended') {
                return res.status(400).json({ error: 'Game has already ended' });
            }

            await query(
                'UPDATE game_participants SET is_active = true, left_at = NULL WHERE game_id = $1 AND user_id = $2',
                [gameId, userId]
            );

            return res.status(202).json({ message: 'Rejoined game successfully' });
        }


        if (game.status !== 'waiting') {
            return res.status(400).json({ error: 'Game has already started or ended' });
        }

        if (game.join_mode === 'code') {
            const provided = (req.body as JoinGameRequest).code?.trim();
            if (!provided) {
                return res.status(401).json({ error: 'Join code required' });
            }
            
            if (!verifyCode(provided, game.join_code_hash)) {
                return res.status(401).json({ error: 'Invalid join code' });
            }
        }

        // users cant join if they have another active game they joined already
        const activeGame = await query(`
            SELECT gp.game_id 
            FROM game_participants gp
            JOIN games g ON gp.game_id = g.game_id
            WHERE gp.user_id = $1 AND gp.is_active = true AND g.status IN ('waiting', 'playing')
        `, [userId]);

        if (activeGame.rows.length > 0) {
            return res.status(409).json({ error: 'You are already in an active game' });
        }

        const orderResult = await query(
            'SELECT COALESCE(MAX(player_order), -1) + 1 as next_order FROM game_participants WHERE game_id = $1',
            [gameId]
        );
        const playerOrder = orderResult.rows[0].next_order;

        
        await query(
            'INSERT INTO game_participants (game_id, user_id, player_order) VALUES ($1, $2, $3)',
            [gameId, userId, playerOrder]
        );

        return res.status(202).json({ message: 'Joined game successfully' });
    } catch (error) {
        console.error('Join game error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});



// Leaving a game
router.post('/:gameId/leave', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);

        if (isNaN(gameId)) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        const client = await getClient();

        try {
            await client.query('BEGIN');

            // check if the user is in the game first and is active
            const participantResult = await client.query(
                'SELECT participant_id FROM game_participants WHERE game_id = $1 AND user_id = $2 AND is_active = true',
                [gameId, userId]
            );

            if (participantResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'You are not in this game' });
            }

            await client.query(
                `UPDATE game_participants
                SET is_active = false,
                    left_at = CURRENT_TIMESTAMP,
                    left_at_round = (SELECT current_round FROM games WHERE game_id = $1)
                WHERE game_id = $1 AND user_id = $2`,
                [gameId, userId]
            );


            
            const gameResult = await client.query(
                'SELECT host_user_id, status FROM games WHERE game_id = $1',
                [gameId]
            );

            const game = gameResult.rows[0];

            // Count
            const activeCount = await client.query(
                'SELECT COUNT(*) as count FROM game_participants WHERE game_id = $1 AND is_active = true',
                [gameId]
            );

            if (parseInt(activeCount.rows[0].count) === 0) {

                await client.query(
                    'UPDATE games SET status = $1, ended_at = CURRENT_TIMESTAMP WHERE game_id = $2',
                    ['ended', gameId]
                );
            } else if (game.host_user_id === userId && game.status === 'waiting') {
                // TODO: it assigns someone else of the host label if the previous host leaves, but that shouldnt happen
                const newHostResult = await client.query(
                    'SELECT user_id FROM game_participants WHERE game_id = $1 AND is_active = true ORDER BY player_order LIMIT 1',
                    [gameId]
                );

                if (newHostResult.rows.length > 0) {
                    await client.query(
                        'UPDATE games SET host_user_id = $1 WHERE game_id = $2',
                        [newHostResult.rows[0].user_id, gameId]
                    );
                }
            }

            await client.query('COMMIT');

            
            try {
                const io = req.app.get('io');
                const broadcastGameList = req.app.get('broadcastGameList');
                const broadcastGameState = req.app.get('broadcastGameState');

                // everyone in the game should know
                io.to(`game:${gameId}`).emit('game:player:left', userId);

                // broadcast
                await broadcastGameList(io);
                await broadcastGameState(io, gameId);
            } catch (e) {
                console.error('Post-leave broadcast failed:', e);
            }

            res.status(202).json({ message: 'Left game successfully' });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Leave game error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// setup and host is the only one that can start the game
router.post('/:gameId/start', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);

        if (isNaN(gameId)) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        const client = await getClient();

        try {
            await client.query('BEGIN');

            const gameResult = await client.query(
                'SELECT game_id, host_user_id, status FROM games WHERE game_id = $1',
                [gameId]
            );

            if (gameResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Game not found' });
            }

            const game = gameResult.rows[0];

            if (game.host_user_id !== userId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Only the host can start the game' });
            }

            if (game.status !== 'waiting') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Game has already started or ended' });
            }

            const participantsResult = await client.query(
                'SELECT user_id, player_order FROM game_participants WHERE game_id = $1 AND is_active = true ORDER BY player_order',
                [gameId]
            );

            if (participantsResult.rows.length < 2) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'At least 2 players are required to start the game' });
            }

            const participants = participantsResult.rows;

            await seedNewRoundState(client, gameId, participants);


            // always the host will start first
            await client.query(
                'UPDATE games SET status = $1, started_at = CURRENT_TIMESTAMP, current_player_id = $2, turn_number = 1 WHERE game_id = $3',
                ['playing', participants[0].user_id, gameId]
            );

            await client.query('COMMIT');

            
            try {
                const io = req.app.get('io');
                const broadcastGameList = req.app.get('broadcastGameList');
                const broadcastGameState = req.app.get('broadcastGameState');

                // broadcast, so clients refresh realtime waiting room players
                io.to(`game:${gameId}`).emit('game:started', { gameId });

                // broadcast, so client refreshes realtime lobby list
                await broadcastGameList(io);

                // likewise
                await broadcastGameState(io, gameId);
            } catch (e) {
                console.error('Post-start broadcasts failed:', e);
            }
            // ---------------------------

            res.status(202).json({ message: 'Game started successfully' });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Start game error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



router.post('/:gameId/rematch/vote', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

        const { yes } = (req.body ?? {}) as { yes: boolean };

        const part = await query(
            `SELECT is_active FROM game_participants WHERE game_id = $1 AND user_id = $2`,
            [gameId, userId]
        );
        if (part.rows.length === 0) return res.status(403).json({ error: 'Not a participant of this game' });
        if (!part.rows[0].is_active) return res.status(403).json({ error: 'Only active players can opt in' });

        const g = await query(`SELECT status FROM games WHERE game_id = $1`, [gameId]);
        if (g.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        if (g.rows[0].status !== 'results') return res.status(409).json({ error: 'Rematch voting only allowed on results screen' });

        await query(
            `UPDATE game_participants
            SET wants_rematch = $3
            WHERE game_id = $1 AND user_id = $2`,
            [gameId, userId, !!yes]
        );

        
        const rows = await query(
            `SELECT gp.user_id, u.username
            FROM game_participants gp
            JOIN users u ON u.user_id = gp.user_id
            WHERE gp.game_id = $1 AND gp.is_active = true AND gp.wants_rematch = true
            ORDER BY gp.player_order`,
            [gameId]
        );

        const payload = {
            ready_count: rows.rows.length,
            ready_users: rows.rows.map(r => ({ user_id: r.user_id, username: r.username }))
        };

        try {
            const io = req.app.get('io');
            io.to(`game:${gameId}`).emit('game:rematch:update', payload);
        } catch (e) {
            console.error('rematch vote broadcast failed:', e);
        }

        return res.json(payload);
    } catch (e) {
        console.error('rematch vote error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


// the next round starts if the host and at least one other player have voted yes
router.post('/:gameId/rematch/start', requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const gameId = parseInt(req.params.gameId);
    if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

    const client = await getClient();
    try {
        await client.query('BEGIN');

        const g = await client.query(
            `SELECT host_user_id, status, current_round FROM games WHERE game_id = $1 FOR UPDATE`,
            [gameId]
        );
        if (g.rows.length === 0) {
            await client.query('ROLLBACK'); return res.status(404).json({ error: 'Game not found' });
        }
        const { host_user_id, status, current_round } = g.rows[0];
        if (host_user_id !== userId) {
            await client.query('ROLLBACK'); return res.status(403).json({ error: 'Only the host can start the next round' });
        }
        if (status !== 'results') {
            await client.query('ROLLBACK'); return res.status(409).json({ error: 'Next round can only start from results' });
        }

        //at least 2 players wants to play
        const readyRows = await client.query(
            `SELECT user_id
            FROM game_participants
            WHERE game_id = $1 AND is_active = true AND wants_rematch = true
            ORDER BY player_order`,
            [gameId]
        );
        const ready = readyRows.rows.map(r => r.user_id);
        if (!ready.includes(host_user_id)) {
            await client.query('ROLLBACK'); return res.status(409).json({ error: 'Host must click "Play Another Round" first' });
        }
        if (ready.length < 2) {
            await client.query('ROLLBACK'); return res.status(409).json({ error: 'At least 2 ready players required' });
        }

        // those who don't want rematch or left out becuase the host started
        await client.query(
            `UPDATE game_participants
            SET is_active = false,
                left_at = CURRENT_TIMESTAMP,
                left_at_round = $2
            WHERE game_id = $1 AND is_active = true AND wants_rematch = false`,
            [gameId, current_round]
        );

        // those remaining who want rematch:
        const participantsResult = await client.query(
            `SELECT user_id, player_order
            FROM game_participants
            WHERE game_id = $1 AND is_active = true AND wants_rematch = true
            ORDER BY player_order`,
            [gameId]
        );

        const participants = participantsResult.rows;
        if (participants.length < 2) {
            await client.query('ROLLBACK'); return res.status(409).json({ error: 'Not enough ready players remaining' });
        }


        // clear previous round state
        await client.query('DELETE FROM player_cards WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM draw_pile WHERE game_id = $1', [gameId]);
        await client.query('DELETE FROM discard_pile WHERE game_id = $1', [gameId]);

        await seedNewRoundState(client, gameId, participants);


        const firstPlayerId = participants[0].user_id;

        
        await client.query(
            `UPDATE games
            SET status = 'playing',
                current_round = $2,
                current_player_id = $3,
                turn_number = 1
            WHERE game_id = $1`,
            [gameId, current_round + 1, firstPlayerId]
        );
        await client.query(`UPDATE game_participants SET wants_rematch = false WHERE game_id = $1`, [gameId]);

        await client.query('COMMIT');

        try {
            const io = req.app.get('io');
            const broadcastGameList = req.app.get('broadcastGameList');
            const broadcastGameState = req.app.get('broadcastGameState');
            io.to(`game:${gameId}`).emit('game:started', { gameId });
            await broadcastGameList(io);
            await broadcastGameState(io, gameId);
        } catch (e) {
            console.error('Post-rematch broadcasts failed:', e);
        }

        return res.status(202).json({ message: 'Next round started' });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('rematch start error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// status of rematch votes as to who wants to play again
router.get('/:gameId/rematch/status', requireAuth, async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

        // only if wants_rematch = true
        const rows = await query(
            `SELECT gp.user_id, u.username
            FROM game_participants gp
            JOIN users u ON u.user_id = gp.user_id
            WHERE gp.game_id = $1 AND gp.is_active = true AND gp.wants_rematch = true
            ORDER BY gp.player_order`,
                [gameId]
        );

        return res.json({
            ready_count: rows.rows.length,
            ready_users: rows.rows.map(r => ({ user_id: r.user_id, username: r.username }))
        });
    } catch (e) {
        console.error('rematch status error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


// Geting game state
router.get('/:gameId/state', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);

        if (isNaN(gameId)) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        // retrive info about the game
        const gameResult = await query(
            'SELECT * FROM games WHERE game_id = $1',
            [gameId]
        );

        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        const game = gameResult.rows[0];

        // getting infos about all players this time
        const playersResult = await query(`
            SELECT 
                gp.user_id,
                u.username,
                gp.player_order,
                gp.is_active
            FROM game_participants gp
            JOIN users u ON gp.user_id = u.user_id
            WHERE gp.game_id = $1
            ORDER BY gp.player_order
        `, [gameId]);

        // organize players
        const players = playersResult.rows.map(row => ({
            user_id: row.user_id,
            username: row.username,
            player_order: row.player_order,
            is_active: row.is_active,
        }));


        // discard top card
        const discardResult = await query(
            'SELECT card_value FROM discard_pile WHERE game_id = $1 ORDER BY discarded_at DESC LIMIT 1',
            [gameId]
        );

        //pile count of the draw pile
        const drawPileResult = await query(
            'SELECT COUNT(*) as count FROM draw_pile WHERE game_id = $1',
            [gameId]
        );

        // getting the specific users cards
        const userCardsResult = await query(
            'SELECT * FROM player_cards WHERE game_id = $1 AND user_id = $2 ORDER BY position_row, position_col',
            [gameId, userId]
        );

        // getting the face up cards of the other players
        const otherCardsResult = await query(
            'SELECT * FROM player_cards WHERE game_id = $1 AND user_id != $2 ORDER BY user_id, position_row, position_col',
            [gameId, userId]
        );

    
        const otherPlayersCards: { [userId: number]: PlayerCard[] } = {};
        for (const card of otherCardsResult.rows) {
            if (!otherPlayersCards[card.user_id]) {
                otherPlayersCards[card.user_id] = [];
            }

            // we are cloning it hard becuase we dont anyone to be able to peek through the network traffic
            const safeCard: any = { ...card };
            if (!card.is_face_up) {
                safeCard.card_value = null; // we set to null to indicate its face-down, and they can only see the back of the card
            }

            otherPlayersCards[card.user_id].push(safeCard);
        }


        
        const gameState: GameState = {
            game_id: game.game_id,
            game_name: game.game_name,
            status: game.status,
            host_user_id: game.host_user_id,
            current_player_id: game.current_player_id,
            current_round: game.current_round,
            turn_number: game.turn_number,

            players,

            top_discard_card: discardResult.rows.length > 0 ? discardResult.rows[0].card_value : undefined,
            draw_pile_count: parseInt(drawPileResult.rows[0].count),
            your_cards: userCardsResult.rows,
            other_players_cards: otherPlayersCards
        };

        
        const pendingRes = await query(
            `
                SELECT pending_card_value, pending_card_source
                FROM game_participants
                WHERE game_id = $1 AND user_id = $2
            `,
            [gameId, userId]
        );

        if (pendingRes.rows.length > 0) {
            gameState.pending_card_value = pendingRes.rows[0].pending_card_value;
            gameState.pending_card_source = pendingRes.rows[0].pending_card_source;
        }

        res.json({ gameState });
    } catch (error) {
        console.error('Get game state error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


router.post('/:gameId/play', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        const { source, action, position } = req.body as PlayCardRequest;

        if (isNaN(gameId)) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        
        if (!isValidMove(action, source, position)) {
            return res.status(400).json({ error: 'Invalid move' });
        }

        
        if (action === 'discard' && source === 'discard') {
            return res.status(400).json({ error: 'You must swap a card if you take from the discard pile' });
        }


        const client = await getClient();

        try {
            await client.query('BEGIN');

            // Check if its actually the usr turn
            const gameResult = await client.query(
                'SELECT current_player_id, status FROM games WHERE game_id = $1',
                [gameId]
            );

            if (gameResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Game not found' });
            }

            const game = gameResult.rows[0];

            if (game.status !== 'playing') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Game is not in playing state' });
            }

            if (game.current_player_id !== userId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'It is not your turn' });
            }

            let drawnCard: number | null = null;

            
            if (action === 'swap' || action === 'discard') {
                if (source === 'draw') {
                    // must have already triggered teh router above
                    const pendingRes = await client.query(
                        `SELECT pending_card_value FROM game_participants
                        WHERE game_id = $1 AND user_id = $2 FOR UPDATE`,
                        [gameId, userId]
                    );
                    if (pendingRes.rows.length === 0 || pendingRes.rows[0].pending_card_value === null) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({ error: 'No pending drawn card found; you cannot play without drawing first' });
                    }
                    drawnCard = pendingRes.rows[0].pending_card_value;
                
                } else {
                    // Draw from the discard pile
                    const discardResult = await client.query(
                        'SELECT card_value, discard_id FROM discard_pile WHERE game_id = $1 ORDER BY discarded_at DESC LIMIT 1',
                        [gameId]
                    );

                    if (discardResult.rows.length === 0) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({ error: 'Discard pile is empty' });
                    }

                    drawnCard = discardResult.rows[0].card_value;

                    // Remove from discard pile since it's being taken
                    await client.query(
                        'DELETE FROM discard_pile WHERE discard_id = $1',
                        [discardResult.rows[0].discard_id]
                    );
                }

                if (action === 'swap' && position) {
                    
                    const cardResult = await client.query(
                        'SELECT card_value FROM player_cards WHERE game_id = $1 AND user_id = $2 AND position_row = $3 AND position_col = $4',
                        [gameId, userId, position.row, position.col]
                    );

                    if (cardResult.rows.length === 0) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({ error: 'Card not found at specified position' });
                    }

                    const oldCard = cardResult.rows[0].card_value;

                    
                    await client.query(
                        'UPDATE player_cards SET card_value = $1, is_face_up = true WHERE game_id = $2 AND user_id = $3 AND position_row = $4 AND position_col = $5',
                        [drawnCard, gameId, userId, position.row, position.col]
                    );

                    
                    await client.query(
                        'INSERT INTO discard_pile (game_id, card_value) VALUES ($1, $2)',
                        [gameId, oldCard]
                    );
                } else if (action === 'discard') {
                    // Directly discard the drawn card if either source is discard or draw pile
                    await client.query(
                        'INSERT INTO discard_pile (game_id, card_value) VALUES ($1, $2)',
                        [gameId, drawnCard]
                    );
                }
            } else if (action === 'flip' && position) {
                
                const cardResult = await client.query(
                    'SELECT is_face_up FROM player_cards WHERE game_id = $1 AND user_id = $2 AND position_row = $3 AND position_col = $4',
                    [gameId, userId, position.row, position.col]
                );

                if (cardResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'Card not found at the specified position' });
                }

                if (cardResult.rows[0].is_face_up) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'Card is already face up' });
                }

                // Finally slip the card if its passes all checks
                await client.query(
                    'UPDATE player_cards SET is_face_up = true WHERE game_id = $1 AND user_id = $2 AND position_row = $3 AND position_col = $4',
                    [gameId, userId, position.row, position.col]
                );
            }

            //---------------------------

            // 
            const allCardsResult = await client.query(
                'SELECT * FROM player_cards WHERE game_id = $1 AND user_id = $2',
                [gameId, userId]
            );

            const allFaceUp = areAllCardsFaceUp(allCardsResult.rows);

            let nextPlayerId: number | null = null;
            let roundEnded = false;

            if (allFaceUp) {
                // after it ended, everyone deck face up 
                await client.query(
                    'UPDATE player_cards SET is_face_up = true WHERE game_id = $1',
                    [gameId]
                );


                const playersResult = await client.query(
                    'SELECT user_id FROM game_participants WHERE game_id = $1 AND is_active = true',
                    [gameId]
                );

                for (const player of playersResult.rows) {
                    const playerCardsResult = await client.query(
                        'SELECT * FROM player_cards WHERE game_id = $1 AND user_id = $2',
                        [gameId, player.user_id]
                    );

                    const score = calculateScore(playerCardsResult.rows);

                    
                    const roundResult = await client.query(
                        'SELECT current_round FROM games WHERE game_id = $1',
                        [gameId]
                    );
                    const currentRound = roundResult.rows[0].current_round;

                    await client.query(
                        'INSERT INTO round_scores (game_id, user_id, round_number, score) VALUES ($1, $2, $3, $4)',
                        [gameId, player.user_id, currentRound, score]
                    );
                }

                //
                await client.query(
                    `UPDATE games
                    SET status = 'results',
                        current_player_id = NULL
                WHERE game_id = $1`,
                    [gameId]
                );


                await client.query(
                    'UPDATE game_participants SET wants_rematch = false WHERE game_id = $1',
                    [gameId]
                );

                roundEnded = true;




            } else {

                const playersResult = await client.query(
                    'SELECT user_id, player_order, is_active FROM game_participants WHERE game_id = $1 ORDER BY player_order',
                    [gameId]
                );

                const computedNext = getNextPlayerId(userId, playersResult.rows);

                // fallback mechanism
                const fallback = playersResult.rows.find(p => p.is_active)?.user_id ?? null;
                const chosenNext = computedNext ?? fallback;

                if (chosenNext === null) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ error: 'No active players available for next turn' });
                }


                await client.query(
                    'UPDATE games SET current_player_id = $1, turn_number = turn_number + 1 WHERE game_id = $2',
                    [chosenNext, gameId]
                );

                // save it
                nextPlayerId = chosenNext;

            }

            await client.query(
                `UPDATE game_participants
                SET pending_card_value = NULL, pending_card_source = NULL
                WHERE game_id = $1 AND user_id = $2`,
                [gameId, userId]
            );


            await client.query('COMMIT');

            // ---- update ----
            try {
                const io = req.app.get('io');
                const broadcastGameState = req.app.get('broadcastGameState');

                // Ask clients to refetch a fresh snapshot (cheap and consistent)
                await broadcastGameState(io, gameId);

                if (roundEnded) {
                    io.to(`game:${gameId}`).emit('game:round:ended', { gameId });
                } else if (nextPlayerId) {
                    io.to(`game:${gameId}`).emit('game:turn:changed', nextPlayerId);
                }
            } catch (e) {
                console.error('Post-move broadcast failed:', e);
            }

            res.status(202).json({ message: 'Move played successfully' });
            //---------------------------
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Play card error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// the name of the game cna be updated as many time in the waiting room
router.patch('/:gameId/name', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        const { game_name } = req.body;

        if (isNaN(gameId)) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        if (!game_name || game_name.trim().length === 0) {
            return res.status(400).json({ error: 'Game name is required' });
        }

        // only host can change the name
        const gameResult = await query(
            'SELECT host_user_id FROM games WHERE game_id = $1',
            [gameId]
        );

        if (gameResult.rows.length === 0) {
            return res.status(404).json({ error: 'Game not found' });
        }

        if (gameResult.rows[0].host_user_id !== userId) {
            return res.status(403).json({ error: 'Only the host can change the game name' });
        }

        // updating it with the new name
        await query(
            'UPDATE games SET game_name = $1 WHERE game_id = $2',
            [game_name.trim(), gameId]
        );

        //
        try {
            const io = req.app.get('io');
            const broadcastGameList = req.app.get('broadcastGameList');
            const broadcastGameState = req.app.get('broadcastGameState');

            await broadcastGameList(io);      
            await broadcastGameState(io, gameId); 
        } catch (e) {
            console.error('Post-name-update broadcasts failed:', e);
        }

        res.status(202).json({ message: 'Game name updated successfully' });

    } catch (error) {
        console.error('Update game name error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// host can abort a game that is in playing state, and everyone is sent back to the lobby
router.delete('/:gameId', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

        const client = await getClient();
        try {
            await client.query('BEGIN');

            const g = await client.query(
                'SELECT host_user_id, status FROM games WHERE game_id = $1',
                [gameId]
            );
            if (g.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Game not found' });
            }

            const { host_user_id } = g.rows[0];
            if (host_user_id !== userId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Only the host can delete the game' });
            }

            // hard delete
            await client.query('DELETE FROM games WHERE game_id = $1', [gameId]);
            await client.query('COMMIT');

            
            const io = req.app.get('io');
            const broadcastGameList = req.app.get('broadcastGameList');

            // 
            io.to(`game:${gameId}`).emit('game:deleted', { gameId });

            // referesh
            await broadcastGameList(io);

            return res.status(204).send();
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Delete game error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


router.post('/:gameId/abort', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

        const g = await query('SELECT host_user_id, status FROM games WHERE game_id = $1', [gameId]);
        if (g.rows.length === 0) return res.status(404).json({ error: 'Game not found' });

        const { host_user_id, status } = g.rows[0];
        if (host_user_id !== userId) return res.status(403).json({ error: 'Only the host can abort the game' });
        if (status !== 'playing') return res.status(409).json({ error: 'Game is not currently playing' });

        await query('UPDATE games SET status = $1, ended_at = CURRENT_TIMESTAMP WHERE game_id = $2', ['ended', gameId]);

        const io = req.app.get('io');
        const broadcastGameList = req.app.get('broadcastGameList');
        const broadcastGameState = req.app.get('broadcastGameState');

        io.to(`game:${gameId}`).emit('game:round:ended', { reason: 'aborted' });
        await broadcastGameList(io);
        await broadcastGameState(io, gameId);

        return res.status(204).send();
    } catch (error) {
        console.error('Abort game error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// drawing from teh drawing pile and you cant go back
router.post('/:gameId/peek', requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const gameId = parseInt(req.params.gameId);
    if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // basic verifications
        const g = await client.query(
            'SELECT current_player_id, status FROM games WHERE game_id = $1 FOR UPDATE',
            [gameId]
        );
        if (g.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Game not found' });
        }
        const { current_player_id, status } = g.rows[0];
        if (status !== 'playing') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Game is not in playing state' });
        }
        if (current_player_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'It is not your turn' });
        }

        // check no other exisiting pending drawn card
        const pendingCheck = await client.query(
            `SELECT pending_card_value FROM game_participants WHERE game_id = $1 AND user_id = $2 FOR UPDATE`,
            [gameId, userId]
        );
        if (pendingCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Not a participant of this game' });
        }
        if (pendingCheck.rows[0].pending_card_value !== null) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'You already have a pending drawn card' });
        }

        // only the top of the draw pile is drawn
        const drawResult = await client.query(
            `SELECT pile_card_id, card_value
                FROM draw_pile
                WHERE game_id = $1
                ORDER BY position_in_pile DESC
                LIMIT 1 FOR UPDATE`,
            [gameId]
        );
        if (drawResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Draw pile is empty' });
        }

        const { pile_card_id, card_value } = drawResult.rows[0];

        // first it removes
        await client.query('DELETE FROM draw_pile WHERE pile_card_id = $1', [pile_card_id]);

        // then it saves it so everyone can see it and the user cant just refresh to avoid it
        await client.query(
            `UPDATE game_participants
                SET pending_card_value = $1, pending_card_source = 'draw'
                WHERE game_id = $2 AND user_id = $3`,
            [card_value, gameId, userId]
        );

        await client.query('COMMIT');

        // everyone gets draw pile changed
        try {
            const io = req.app.get('io');
            const broadcastGameState = req.app.get('broadcastGameState');
            await broadcastGameState(io, gameId);
        } catch (e) {
            console.error('Broadcast pending draw failed:', e);
        }

        return res.json({ card_value });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('peek/draw commit error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});


// host can kick players and block from re-joining back
router.post('/:gameId/kick', requireAuth, async (req: Request, res: Response) => {
    try {
        const hostId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        const { user_id } = req.body as { user_id: number };

        if (isNaN(gameId) || !user_id) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        const client = await getClient();
        try {
            await client.query('BEGIN');

            const g = await client.query(
                'SELECT host_user_id, status FROM games WHERE game_id = $1',
                [gameId]
            );
            if (g.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Game not found' });
            }
            const { host_user_id, status } = g.rows[0];
            if (host_user_id !== hostId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Only the host can kick players' });
            }
            if (status !== 'waiting') {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Can only kick during waiting' });
            }
            if (user_id === hostId) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Host cannot kick themselves' });
            }

            // make sure the user is actually in the waiting room
            const p = await client.query(
                'SELECT is_active FROM game_participants WHERE game_id = $1 AND user_id = $2',
                [gameId, user_id]
            );
            if (p.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Player not in this waiting room' });
            }

            
            if (p.rows[0].is_active) {
                await client.query(
                    'UPDATE game_participants SET is_active = false, left_at = CURRENT_TIMESTAMP WHERE game_id = $1 AND user_id = $2',
                    [gameId, user_id]
                );
            }

            // record the kick for this indiviudal so they don't rejoin
            await client.query(
                `INSERT INTO game_kicks (game_id, user_id, kicked_by_user_id)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (game_id, user_id) DO NOTHING`,
                [gameId, user_id, hostId]
            );

            await client.query('COMMIT');

            
            const io = req.app.get('io');
            const broadcastGameState = req.app.get('broadcastGameState');
            io.to(`game:${gameId}`).emit('game:kicked', { game_id: gameId, user_id });
            await broadcastGameState(io, gameId);

            return res.status(204).send();
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Kick player error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// scores for the overall leaderboard; every rounds up to this point added for each player
router.get('/:gameId/leaderboard', requireAuth, async (req: Request, res: Response) => {
    try {
        const gameId = parseInt(req.params.gameId);
        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

        // users from teh game, also including those who left halfway the game
        const players = await query(
            `SELECT gp.user_id, u.username
            FROM game_participants gp
            JOIN users u ON u.user_id = gp.user_id
            WHERE gp.game_id = $1 AND gp.is_active = true
            ORDER BY gp.player_order`,
            [gameId]
        );

        // adding up scores from round_scores
        const agg = await query(
            `SELECT user_id,
                    COUNT(*) AS rounds,
                    SUM(score)::int AS total,
                    AVG(score)::float AS avg
            FROM round_scores
            WHERE game_id = $1
            GROUP BY user_id`,
            [gameId]
        );

        const byUser: Record<number, { rounds: number; total: number; avg: number }> = {};
        agg.rows.forEach(r => {
            byUser[r.user_id] = {
                rounds: parseInt(r.rounds, 10),
                total: parseInt(r.total, 10),
                avg: parseFloat(r.avg),
            };
        });

        const leaderboard = players.rows.map(p => ({
            user_id: p.user_id,
            username: p.username,
            rounds: byUser[p.user_id]?.rounds ?? 0,
            total: byUser[p.user_id]?.total ?? 0,
            avg: byUser[p.user_id]?.avg ?? 0,
        }));

        return res.json({ leaderboard });
    } catch (error) {
        console.error('Leaderboard error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


router.get('/:gameId/left', requireAuth, async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });

        // only include players who played through and left midway, not those who were kicked from the waiting room
        const left = await query(
            `
            SELECT gp.user_id, u.username, gp.left_at_round
            FROM game_participants gp
            JOIN users u ON u.user_id = gp.user_id
            WHERE gp.game_id = $1
                AND gp.is_active = false
                AND gp.left_at IS NOT NULL
                AND (
                    gp.left_at_round IS NOT NULL
                OR EXISTS (
                        SELECT 1
                        FROM round_scores rs
                        WHERE rs.game_id = gp.game_id
                        AND rs.user_id = gp.user_id
                )
                )
            ORDER BY COALESCE(gp.left_at_round, 999999), gp.user_id
        `, [gameId]
        );

        const totals = await query(
            `
            SELECT user_id, SUM(score)::int AS total
            FROM round_scores
            WHERE game_id = $1
            GROUP BY user_id
        `,
            [gameId]
        );
        const totalsByUser = new Map<number, number>(totals.rows.map(r => [r.user_id, r.total]));

        const payload = left.rows.map(r => ({
            user_id: r.user_id,
            username: r.username,
            left_at_round: r.left_at_round ?? null,
            total: totalsByUser.get(r.user_id) ?? 0
        }));

        return res.json({ left: payload });
    } catch (e) {
        console.error('left list error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


// 
router.get('/:gameId/round/:round/scores', requireAuth, async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
        const roundNo = parseInt(req.params.round);
        const readyOnly = String(req.query.readyOnly || '').toLowerCase() === 'true';

        if (isNaN(gameId) || isNaN(roundNo)) {
            return res.status(400).json({ error: 'Invalid game/round' });
        }

        
        let sql = `
            SELECT rs.user_id, u.username, rs.score::int AS score
            FROM round_scores rs
            JOIN users u ON u.user_id = rs.user_id
            WHERE rs.game_id = $1 AND rs.round_number = $2
        `;
        const params: any[] = [gameId, roundNo];

        // if people opted in for rematch only, show them on the results screen
        if (readyOnly) {
            sql += `
                AND EXISTS (
                SELECT 1
                    FROM game_participants gp
                WHERE gp.game_id = rs.game_id
                    AND gp.user_id = rs.user_id
                    AND gp.is_active = true
                    AND gp.wants_rematch = true
                )
            `;
        }

        sql += ` ORDER BY rs.score ASC`;

        const r = await query(sql, params);
        return res.json({ scores: r.rows });
    } catch (e) {
        console.error('round scores error:', e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


export default router;
