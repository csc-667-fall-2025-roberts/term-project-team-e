
exports.shorthands = {};

exports.up = (pgm) => {
    // USERS
    pgm.createTable('users', {
        user_id: { type: 'serial', primaryKey: true },
        email: { type: 'varchar(255)', notNull: true, unique: true },
        username: { type: 'varchar(50)', notNull: true, unique: true },
        password_hash: { type: 'varchar(255)', notNull: true },
        created_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') },
        last_login: { type: 'timestamp' }
    });

    // GAMES
    pgm.createTable('games', {
        game_id: { type: 'serial', primaryKey: true },
        game_name: { type: 'varchar(100)', notNull: true },
        host_user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        status: { type: 'varchar(20)', notNull: true },
        current_player_id: {
            type: 'integer',
            references: 'users'
        },
        current_round: { type: 'integer', notNull: true, default: 1 },
        turn_number: { type: 'integer', notNull: true, default: 0 },
        join_mode: { type: 'varchar(10)', notNull: true, default: 'open' },
        join_code_hash: { type: 'varchar(255)' },
        join_code_set_at: { type: 'timestamp' },
        created_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') },
        started_at: { type: 'timestamp' },
        ended_at: { type: 'timestamp' }
    });

    pgm.addConstraint(
        'games',
        'games_status_check',
        "CHECK (status IN ('waiting','playing','results','ended'))"
    );
    pgm.addConstraint(
        'games',
        'games_join_mode_check',
        "CHECK (join_mode IN ('open','code'))"
    );

    // GAME PARTICIPANTS
    pgm.createTable('game_participants', {
        participant_id: { type: 'serial', primaryKey: true },
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        player_order: { type: 'integer', notNull: true },
        is_active: { type: 'boolean', notNull: true, default: true },
        wants_rematch: { type: 'boolean', notNull: true, default: false },
        left_at: { type: 'timestamp' },
        left_at_round: { type: 'integer' },
        pending_card_value: { type: 'integer' },
        pending_card_source: { type: 'varchar(10)' },
        joined_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') }
    });

    pgm.addConstraint(
        'game_participants',
        'game_participants_unique_game_user',
        'UNIQUE(game_id, user_id)'
    );
    pgm.addConstraint(
        'game_participants',
        'game_participants_unique_game_order',
        'UNIQUE(game_id, player_order)'
    );
    pgm.addConstraint(
        'game_participants',
        'game_participants_pending_source_check',
        "CHECK (pending_card_source IN ('draw','discard'))"
    );

    // PLAYER CARDS
    pgm.createTable('player_cards', {
        card_id: { type: 'serial', primaryKey: true },
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        card_value: { type: 'integer', notNull: true },
        position_row: { type: 'integer', notNull: true },
        position_col: { type: 'integer', notNull: true },
        is_face_up: { type: 'boolean', notNull: true, default: false }
    });

    pgm.addConstraint(
        'player_cards',
        'player_cards_value_check',
        'CHECK (card_value BETWEEN -2 AND 13)'
    );
    pgm.addConstraint(
        'player_cards',
        'player_cards_position_row_check',
        'CHECK (position_row IN (0, 1))'
    );
    pgm.addConstraint(
        'player_cards',
        'player_cards_position_col_check',
        'CHECK (position_col IN (0, 1, 2))'
    );
    pgm.addConstraint(
        'player_cards',
        'player_cards_unique_slot',
        'UNIQUE(game_id, user_id, position_row, position_col)'
    );

    // DRAW PILE
    pgm.createTable('draw_pile', {
        pile_card_id: { type: 'serial', primaryKey: true },
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        card_value: { type: 'integer', notNull: true },
        position_in_pile: { type: 'integer', notNull: true }
    });

    pgm.addConstraint(
        'draw_pile',
        'draw_pile_value_check',
        'CHECK (card_value BETWEEN -2 AND 13)'
    );
    pgm.addConstraint(
        'draw_pile',
        'draw_pile_unique_position',
        'UNIQUE(game_id, position_in_pile)'
    );

    // DISCARD PILE
    pgm.createTable('discard_pile', {
        discard_id: { type: 'serial', primaryKey: true },
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        card_value: { type: 'integer', notNull: true },
        discarded_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') }
    });

    pgm.addConstraint(
        'discard_pile',
        'discard_pile_value_check',
        'CHECK (card_value BETWEEN -2 AND 13)'
    );

    // ROUND SCORES
    pgm.createTable('round_scores', {
        score_id: { type: 'serial', primaryKey: true },
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        round_number: { type: 'integer', notNull: true },
        score: { type: 'integer', notNull: true },
        created_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') }
    });

    pgm.addConstraint(
        'round_scores',
        'round_scores_unique_game_user_round',
        'UNIQUE(game_id, user_id, round_number)'
    );

    // LOBBY CHAT
    pgm.createTable('lobby_chat', {
        message_id: { type: 'serial', primaryKey: true },
        user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        message: { type: 'text', notNull: true },
        created_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') }
    });

    // WAITING ROOM CHAT
    pgm.createTable('waiting_room_chat', {
        message_id: { type: 'serial', primaryKey: true },
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        message: { type: 'text', notNull: true },
        created_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') }
    });

    // GAME CHAT
    pgm.createTable('game_chat', {
        message_id: { type: 'serial', primaryKey: true },
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        message: { type: 'text', notNull: true },
        round_number: { type: 'integer' },
        created_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') }
    });

    // GAME KICKS
    pgm.createTable('game_kicks', {
        game_id: {
            type: 'integer',
            notNull: true,
            references: 'games',
            onDelete: 'CASCADE'
        },
        user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        kicked_by_user_id: {
            type: 'integer',
            notNull: true,
            references: 'users',
            onDelete: 'CASCADE'
        },
        created_at: { type: 'timestamp', default: pgm.func('CURRENT_TIMESTAMP') }
    });

    pgm.addConstraint(
        'game_kicks',
        'game_kicks_pk',
        'PRIMARY KEY (game_id, user_id)'
    );

    // SESSION (for connect-pg-simple)
    pgm.createTable('session', {
        sid: { type: 'varchar', primaryKey: true, notNull: true },
        sess: { type: 'json', notNull: true },
        expire: { type: 'timestamp(6)', notNull: true }
    });

    // INDEXES
    pgm.createIndex('session', 'expire', { name: 'idx_session_expire' });

    pgm.createIndex('users', 'email', { name: 'idx_users_email' });

    pgm.createIndex('games', 'status', { name: 'idx_games_status' });
    pgm.createIndex('games', 'host_user_id', { name: 'idx_games_host' });

    pgm.createIndex('game_participants', 'game_id', {
        name: 'idx_game_participants_game'
    });
    pgm.createIndex('game_participants', 'user_id', {
        name: 'idx_game_participants_user'
    });
    pgm.createIndex('game_participants', ['game_id', 'wants_rematch'], {
        name: 'idx_game_participants_wants'
    });

    pgm.createIndex('player_cards', ['game_id', 'user_id'], {
        name: 'idx_player_cards_game_user'
    });

    pgm.createIndex('round_scores', 'game_id', {
        name: 'idx_round_scores_game'
    });

    pgm.createIndex('lobby_chat', 'created_at', {
        name: 'idx_lobby_chat_created'
    });
    pgm.createIndex('game_chat', ['game_id', 'created_at'], {
        name: 'idx_game_chat_game'
    });
    pgm.createIndex('game_chat', ['game_id', 'round_number', 'created_at'], {
        name: 'idx_game_chat_game_round'
    });
};

exports.down = (pgm) => {
    // drop in reverse dependency order
    pgm.dropTable('game_chat');
    pgm.dropTable('waiting_room_chat');
    pgm.dropTable('lobby_chat');
    pgm.dropTable('round_scores');
    pgm.dropTable('discard_pile');
    pgm.dropTable('draw_pile');
    pgm.dropTable('player_cards');
    pgm.dropTable('game_participants');
    pgm.dropTable('game_kicks');
    pgm.dropTable('session');
    pgm.dropTable('games');
    pgm.dropTable('users');
};
