
// types for user
export interface User {
    user_id: number;
    email: string;
    username: string;
    created_at: Date;
    last_login?: Date;
}


export type GameStatus = 'waiting' | 'playing' | 'ended';

export type JoinMode = 'open' | 'code';

export interface Game {
    game_id: number;
    game_name: string;
    host_user_id: number;
    status: GameStatus;
    current_player_id?: number;
    current_round: number;
    turn_number: number;
    created_at: Date;
    started_at?: Date;
    ended_at?: Date;

    join_mode?: JoinMode;          
    join_code_set_at?: Date;       
}

export interface GameParticipant {
    participant_id: number;
    game_id: number;
    user_id: number;
    player_order: number;
    is_active: boolean;
    joined_at: Date;
    left_at?: Date;
}


export interface PlayerCard {
    card_id: number;
    game_id: number;
    user_id: number;
    card_value: number;
    position_row: 0 | 1;
    position_col: 0 | 1 | 2;
    is_face_up: boolean;
}

export interface DrawPileCard {
    pile_card_id: number;
    game_id: number;
    card_value: number;
    position_in_pile: number;
}

export interface DiscardPileCard {
    discard_id: number;
    game_id: number;
    card_value: number;
    discarded_at: Date;
}


export interface RoundScore {
    score_id: number;
    game_id: number;
    user_id: number;
    round_number: number;
    score: number;
    created_at: Date;
}


export interface LobbyChatMessage {
    message_id: number;
    user_id: number;
    username: string;
    message: string;
    created_at: Date;
}

export interface GameChatMessage {
    message_id: number;
    game_id: number;
    user_id: number;
    username: string;
    message: string;
    created_at: Date;
}

export interface WaitingRoomChatMessage {
    message_id: number;
    game_id: number;
    user_id: number;
    username: string;
    message: string;
    created_at: Date;
}



declare module 'express-session' {
    interface SessionData {
        userId?: number;
        username?: string;
    }
}

// Request/Response types
export interface SignupRequest {
    email: string;
    username: string;
    password: string;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface CreateGameRequest {
    game_name: string;

    join_mode?: JoinMode;          // open or code
    join_code?: string;            // if code mode, the code to set
}

export interface JoinGameRequest {
    game_id: number;

    code?: string;             
}

export interface KickPlayerRequest {
    user_id: number;               
}

export interface PlayCardRequest {
    source: 'draw' | 'discard';
    action: 'swap' | 'discard' | 'flip';
    position?: {
        row: 0 | 1;
        col: 0 | 1 | 2;
    };
}

export interface SendMessageRequest {
    message: string;
}

// Socket.IO event types
export interface ServerToClientEvents {
    // Lobby events
    'lobby:games:update': (games: GameListItem[]) => void;
    'lobby:chat:message': (message: LobbyChatMessage) => void;

    'game:state:dirty': () => void;
    
    //  events for game
    'game:state:update': (gameState: GameState) => void;

    // this is really waiting:started
    'game:started': (data: { gameId: number }) => void;
    // this is really waiting:kicked
    'game:kicked': (data: { game_id: number; user_id: number }) => void;

    // we need to create a seprate waiting:player:joined and waiting:player:left events, becuase now its using these
    'game:player:joined': (player: PlayerInfo) => void;
    'game:player:left': (userId: number) => void;


    'game:turn:changed': (currentPlayerId: number) => void;
    'game:card:drawn': (data: { userId: number; source: 'draw' | 'discard' }) => void;
    'game:card:played': (data: CardPlayedData) => void;
    'game:hand:update': (cards: PlayerCard[]) => void;
    'game:round:ended': (roundResults: RoundResults) => void;
    'game:chat:message': (message: GameChatMessage) => void;
    'game:rematch:update': (data: { ready_count: number; ready_users: { user_id: number; username: string }[] }) => void;


    'waiting:chat:message': (message: WaitingRoomChatMessage) => void;
    
    // events for game
    'error': (message: string) => void;
}

export interface ClientToServerEvents {
    'lobby:join': () => void;
    'lobby:leave': () => void;
    'lobby:chat:send': (message: string) => void;
    
    // waiting is using game:join and game:leave for now, need to have its own events
    'game:join': (gameId: number) => void;
    'game:leave': (gameId: number) => void;

    'game:chat:send': (data: { gameId: number; message: string }) => void;

    'waiting:chat:send': (data: { gameId: number; message: string }) => void;

}

// types - game state 
export interface GameListItem {
    game_id: number;
    game_name: string;
    host_username: string;
    status: GameStatus;
    player_count: number;
    can_join: boolean;
    can_spectate: boolean;
    is_participant: boolean;

    requires_code?: boolean;      
}

export interface PlayerInfo {
    user_id: number;
    username: string;
    player_order: number;
    is_active: boolean;
    score?: number;
}

export interface GameState {
    game_id: number;
    game_name: string;
    status: GameStatus;
    host_user_id: number;
    current_player_id?: number;
    current_round: number;
    turn_number: number;
    players: PlayerInfo[];
    top_discard_card?: number;
    draw_pile_count: number;
    your_cards?: PlayerCard[];
    other_players_cards: {
        [userId: number]: PlayerCard[];
    };

    pending_card_value?: number | null;
    pending_card_source?: 'draw' | 'discard' | null;
}

export interface CardPlayedData {
    user_id: number;
    action: 'swap' | 'discard' | 'flip';
    card_value?: number;
    position?: {
        row: 0 | 1;
        col: 0 | 1 | 2;
    };
    new_card_value?: number;
}

export interface RoundResults {
    round_number: number;
    scores: {
        user_id: number;
        username: string;
        round_score: number;
        total_score: number;
        cards: PlayerCard[];
    }[];
    continue_countdown: number;
}
