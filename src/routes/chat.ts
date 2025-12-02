import express, { Request, Response } from 'express';
import { query } from '../db/database';
import { requireAuth } from '../middleware/auth';
import { SendMessageRequest } from '../types';

const router = express.Router();

// Get: lobby chat 
router.get('/lobby', requireAuth, async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;

        const result = await query(`
            SELECT 
                lc.message_id,
                lc.user_id,
                u.username,
                lc.message,
                lc.created_at
            FROM lobby_chat lc
            JOIN users u ON lc.user_id = u.user_id
            ORDER BY lc.created_at DESC
            LIMIT $1
        `, [limit]);

        res.json({ messages: result.rows.reverse() });
    } catch (error) {
        console.error('Get lobby chat error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send: lobby chat message
router.post('/lobby', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const { message } = req.body as SendMessageRequest;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        if (message.length > 500) {
            return res.status(400).json({ error: 'Message is too long (max 500 characters)' });
        }

        await query(
            'INSERT INTO lobby_chat (user_id, message) VALUES ($1, $2)',
            [userId, message.trim()]
        );

        res.status(202).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('Send lobby chat error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get: game chat messages
router.get('/games/:gameId', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        const limit = parseInt(req.query.limit as string) || 50;

        if (isNaN(gameId)) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }

        // Are they an active/previous participant?
        const part = await query(
            'SELECT participant_id FROM game_participants WHERE game_id = $1 AND user_id = $2',
            [gameId, userId]
        );

        if (part.rows.length === 0) {
            // Not a participant so they read-only spectating iff game is visible
            const g = await query('SELECT status, current_round FROM games WHERE game_id = $1', [gameId]);
            if (g.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
            const canSpectate = g.rows[0].status === 'playing' || g.rows[0].status === 'results';
            if (!canSpectate) return res.status(403).json({ error: 'You are not in this game' });

            // Default to current round
            const round = parseInt(String(req.query.round || g.rows[0].current_round), 10);
            const result = await query(`
                SELECT 
                gc.message_id,
                gc.game_id,
                gc.user_id,
                u.username,
                gc.message,
                gc.created_at
                FROM game_chat gc
                JOIN users u ON gc.user_id = u.user_id
                WHERE gc.game_id = $1 AND (gc.round_number = $2 OR $2 IS NULL)
                ORDER BY gc.created_at DESC
                LIMIT $3
            `, [gameId, round || null, limit]);

            return res.json({ messages: result.rows.reverse() });
        }

        const g = await query('SELECT current_round FROM games WHERE game_id = $1', [gameId]);
        if (g.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        const round = parseInt(String(req.query.round || g.rows[0].current_round), 10);

        const result = await query(`
            SELECT 
                gc.message_id,
                gc.game_id,
                gc.user_id,
                u.username,
                gc.message,
                gc.created_at
            FROM game_chat gc
            JOIN users u ON gc.user_id = u.user_id
            WHERE gc.game_id = $1 AND (gc.round_number = $2 OR $2 IS NULL)
            ORDER BY gc.created_at DESC
            LIMIT $3
        `, [gameId, round || null, limit]);

        res.json({ messages: result.rows.reverse() });
    } catch (error) {
        console.error('Get game chat error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send: game chat message
router.post('/games/:gameId', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        const { message } = req.body as SendMessageRequest;

        if (isNaN(gameId)) return res.status(400).json({ error: 'Invalid game ID' });
        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }
        if (message.length > 500) {
            return res.status(400).json({ error: 'Message is too long (max 500 characters)' });
        }

        // only active participants can send messages, so they are not bombarded with spectators chats
        const participantCheck = await query(
            'SELECT participant_id FROM game_participants WHERE game_id = $1 AND user_id = $2 AND is_active = true',
            [gameId, userId]
        );
        if (participantCheck.rows.length === 0) {
            return res.status(403).json({ error: 'You are not in this game' });
        }

        const r = await query('SELECT current_round FROM games WHERE game_id = $1', [gameId]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Game not found' });
        const round_number = r.rows[0].current_round;

        await query(
            'INSERT INTO game_chat (game_id, user_id, message, round_number) VALUES ($1, $2, $3, $4)',
            [gameId, userId, message.trim(), round_number]
        );

        res.status(202).json({ message: 'Message sent successfully' });
    } catch (error) {
        console.error('Send game chat error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



// Get: waiting room chat
router.get('/waiting/:gameId', requireAuth, async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);

        const r = await query(
            `SELECT wc.message_id, wc.user_id, u.username, wc.message, wc.created_at
                FROM waiting_room_chat wc
                JOIN users u ON wc.user_id = u.user_id
                WHERE wc.game_id = $1
                ORDER BY wc.created_at ASC`,
            [gameId]
        );

        res.json({ messages: r.rows });

    } catch (err) {
        console.error('Load waiting room chat error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Send: waiting room chat message
router.post('/waiting/:gameId', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId!;
        const gameId = parseInt(req.params.gameId);
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        await query(`
            INSERT INTO waiting_room_chat (game_id, user_id, message)
            VALUES ($1, $2, $3)
        `, [gameId, userId, message.trim()]);

        res.status(202).json({ message: 'Message sent successfully' });
    } catch (e) {
        console.error('Send waiting-room chat error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});


export default router;