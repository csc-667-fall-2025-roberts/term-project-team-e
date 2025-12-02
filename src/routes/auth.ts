import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { query } from '../db/database';
import { requireAuth } from '../middleware/auth';
import { SignupRequest, LoginRequest } from '../types';

const router = express.Router();

// ---------- SIGNUP ----------
router.post('/signup', async (req: Request, res: Response) => {
    try {
        if (req.session.userId) {
            return res.status(409).json({ error: 'Already logged in' });
        }

        const { email, username, password } = req.body as SignupRequest;

        if (!email || !username || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        if (username.length < 3 || username.length > 50) {
            return res.status(400).json({ error: 'Username must be between 3 and 50 characters' });
        }

        const existingUser = await query(
            'SELECT user_id FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email or username already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const result = await query(
            'INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING user_id, username, email',
            [email, username, passwordHash]
        );

        const newUser = result.rows[0];

        req.session.userId = newUser.user_id;
        req.session.username = newUser.username;

        return res.status(201).json({
            message: 'User created successfully',
            user: { user_id: newUser.user_id, username: newUser.username, email: newUser.email }
        });
    } catch (error) {
        console.error('Signup error:', error);
        if (res.headersSent) return; // if already sent response, do nothing
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ------------- LOGIN ----------
router.post('/login', async (req: Request, res: Response) => {
    try {
        // if already logged in, you are already authenticated, treat as success
        if (req.session.userId) {
            return res.status(200).json({
                status: 'ok',
                alreadyAuthenticated: true,
                user: { user_id: req.session.userId, username: req.session.username }
            });
        }

        const { email, password } = req.body as LoginRequest;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await query(
            'SELECT user_id, username, email, password_hash FROM users WHERE email = $1',
            [email]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = result.rows[0];
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1', [user.user_id]);

        req.session.userId = user.user_id;
        req.session.username = user.username;

        return res.json({
            message: 'Login successful',
            user: { user_id: user.user_id, username: user.username, email: user.email }
        });
    } catch (error) {
        console.error('Login error:', error);
        if (res.headersSent) return; 
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------- LOGOUT ----------------
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
    try {
        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ error: 'Failed to logout' });
            }
            res.clearCookie('connect.sid');
            return res.json({ message: 'Logout successful' });
        });
    } catch (error) {
        console.error('Logout error:', error);
        if (res.headersSent) return;
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ------------- ME - public ---------------
router.get('/me', async (req: Request, res: Response) => {
    try {
        if (!req.session.userId) {
            return res.status(200).json({ authenticated: false });
        }
        const result = await query(
            'SELECT user_id, username, email, created_at FROM users WHERE user_id = $1',
            [req.session.userId]
        );
        if (result.rows.length === 0) {
            return res.status(200).json({ authenticated: false });
        }
        return res.json({ authenticated: true, user: result.rows[0] });
    } catch (error) {
        console.error('Get user error:', error);
        if (res.headersSent) return;
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// everything absorbed into router
export default router;
