import { PlayerCard } from '../types';


export function createDeck(playerCount: number = 2): number[] {
    const decks: number[] = [];

    // 52 decks for 3 players, and then doubles after thate
    let deckCount = 1;
    if (playerCount >= 4 && playerCount <= 8) deckCount = 2;
    else if (playerCount >= 9 && playerCount <= 12) deckCount = 3;
    else if (playerCount >= 13 && playerCount <= 16) deckCount = 4;
    else if (playerCount > 16) {
        deckCount = Math.ceil(playerCount / 4); 
    }

    for (let d = 0; d < deckCount; d++) {
        // at most 2 jokers per deck
        decks.push(-2, -2);

        // 4 suits
        for (let suit = 0; suit < 4; suit++) {
            for (let value = 1; value <= 13; value++) {
                if (value === 13) {
                    decks.push(0); // King = 0 points
                } else {
                    decks.push(value);
                }
            }
        }
    }

    return decks;
}



export function shuffleDeck(deck: number[]): number[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)); // Fisher-Yates algorithm
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}


function scoreOf(v: number): number {
    if (v === 11 || v === 12) return 10; // if they are jack & Queen, it will be 10 points
    return v; // the joker and king are already handled, and the others are face value
}

export function calculateScore(cards: PlayerCard[]): number {
    let totalScore = 0;

    // effectively grouping them by columns
    const columns: { [col: number]: PlayerCard[] } = { 0: [], 1: [], 2: [] };

    //only count face up cards
    for (const card of cards) {
        if (card.is_face_up) columns[card.position_col].push(card);
    }

    // if a column matches, nothing would be added to total score
    for (let col = 0; col < 3; col++) {
        const c = columns[col];
        if (c.length === 2) {
            const [a, b] = c;
            if (a.card_value !== b.card_value) {
                totalScore += scoreOf(a.card_value) + scoreOf(b.card_value);
            }
        } else if (c.length === 1) {
            totalScore += scoreOf(c[0].card_value);
        }
    }

    return totalScore;
}


// if it returns true, we end the round
export function areAllCardsFaceUp(cards: PlayerCard[]): boolean {
    return cards.every(card => card.is_face_up);
}

// position validity checker
export function isValidPosition(row: number, col: number): boolean {
    return (row === 0 || row === 1) && (col === 0 || col === 1 || col === 2);
}

// Get next player in turn order
export function getNextPlayerId(
    currentPlayerId: number,
    players: Array<{ user_id: number; player_order: number; is_active: boolean }>
): number | null {
    // filter and sort active players by player_order
    const activePlayers = players
        .filter(p => p.is_active)
        .sort((a, b) => a.player_order - b.player_order);

    if (activePlayers.length === 0) {
        return null;
    }

    // current player
    const currentIndex = activePlayers.findIndex(p => p.user_id === currentPlayerId);

    if (currentIndex === -1) {
        // as a falleback, return the first player taht was active
        return activePlayers[0].user_id;
    }

    // wrap around if at the end
    const nextIndex = (currentIndex + 1) % activePlayers.length;
    return activePlayers[nextIndex].user_id;
}

// initial card handing function
export function dealInitialCards(
    deck: number[],
    playerCount: number
): { playerCards: number[][]; remainingDeck: number[] } {
    const cardsPerPlayer = 6;
    const playerCards: number[][] = [];
    let deckIndex = 0;

    // give six cards to all the active players
    for (let i = 0; i < playerCount; i++) {
        const cards = deck.slice(deckIndex, deckIndex + cardsPerPlayer);
        playerCards.push(cards);
        deckIndex += cardsPerPlayer;
    }

    // this will be the middle pile with one card face up in the discard pile
    const remainingDeck = deck.slice(deckIndex);

    return { playerCards, remainingDeck };
}

// validity checker for moves
export function isValidMove(
    action: 'swap' | 'discard' | 'flip',
    source: 'draw' | 'discard',
    position?: { row: number; col: number }
): boolean {
    if (action === 'flip') {

        return position !== undefined && isValidPosition(position.row, position.col);
    }

    if (action === 'swap') {
        return position !== undefined && isValidPosition(position.row, position.col);
    }

    if (action === 'discard') {
        return true; // doesnt need posiiton validation
    }

    return false;
}
