import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// PostgreSQL connection pool config.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
});

// ------------------------ Some event listeners for debugging --------------------------------
pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});
// --------------------------------------------------------------------------------------------

// Query helper function
export async function query(text: string, params?: any[]) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log('Executed query', { text, duration, rows: res.rowCount });
        return res;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// client helper function for complex transactions that need to happen in one query; games routes uses this
export async function getClient(): Promise<PoolClient> {
    const client = await pool.connect();
    return client;
}

// Initialize database schema; we wont need this
export async function initializeDatabase() {
    const fs = require('fs');
    const path = require('path');
    
    try {
        // use schema.sql to set up the database
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        await query(schema);
        console.log('Successful: Database schema initialized');
    } catch (error) {
        console.error('Failed: Unable to initialize database schema:', error);
        throw error;
    }
}

export default pool;