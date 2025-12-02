
const socket = io();

let currentUser = null;
let gameId = null;
let gameState = null;
let drawnCard = null;   
let drawSource = null;  

let isParticipant = true;
let isHost = false;

// DOM
const els = {
    roleLabel: () => document.getElementById('roleLabel'),
    gameName: () => document.getElementById('gameName'),
    currentPlayerName: () => document.getElementById('currentPlayerName'),
    yourTurnIndicator: () => document.getElementById('yourTurnIndicator'),
    drawBtn: () => document.getElementById('drawPileBtn'),
    discardBtnPile: () => document.getElementById('discardPileBtn'),
    discardPileFace: () => document.getElementById('discardPileCard'),
    drawCount: () => document.getElementById('drawPileCount'),
    actions: () => document.getElementById('actionButtons'),
    swapBtn: () => document.getElementById('swapBtn'),
    discardBtnAction: () => document.getElementById('discardBtn'),
    cancelBtn: () => document.getElementById('cancelBtn'),
    pendingArea: () => document.getElementById('pendingCardArea'),
    pendingCard: () => document.getElementById('pendingCard'),
    yourCardsWrap: () => document.querySelector('#yourCards').closest('.bg-white'),
    yourCards: () => document.getElementById('yourCards'),
    yourScore: () => document.getElementById('yourScore'),
    otherPlayers: () => document.getElementById('otherPlayers'),
    leaveGameBtn: () => document.getElementById('leaveGameBtn'),
    backToLobbyBtn: () => document.getElementById('backToLobbyBtn'),
    roundBadge: () => document.getElementById('roundBadge'),
};

function getGameId() {
    const parts = window.location.pathname.split('/');
    return parseInt(parts[parts.length - 1], 10);
}
gameId = getGameId();

// Current user
async function getCurrentUser() {
    try {
        const r = await fetch('/api/auth/me');
        if (!r.ok) return (window.location.href = '/');
        const data = await r.json();
        currentUser = data.user;
        document.getElementById('username').textContent = currentUser.username;
    } catch (e) {
        console.error(e);
        window.location.href = '/';
    }
}

// loading game state
async function loadGameState() {
    try {
        const r = await fetch(`/api/games/${gameId}/state`);

        if (!r.ok) {
            alert('Failed to load game');
            return (window.location.href = '/lobby');
        }

        const data = await r.json();
        gameState = data.gameState;

        isHost = currentUser && gameState && currentUser.user_id === gameState.host_user_id;

        if (gameState.status === 'results') {
            window.location.href = `/results/${gameId}`;
            return;
        }

        if (gameState.status === 'ended') {
            window.location.href = `/lobby`;
            return;
        }

        isParticipant = !!gameState.players.find(
            p => p.user_id === currentUser.user_id && p.is_active === true
        );

        // Restore pending drawn card from the server
        if (gameState.pending_card_value !== null && gameState.pending_card_source) {
            drawnCard = gameState.pending_card_value;
            drawSource = gameState.pending_card_source;

            els.pendingArea().classList.remove('hidden');
            els.pendingCard().innerHTML = renderFaceUpCard(drawnCard, 'h-full');
            els.actions().classList.remove('hidden');

            // you cant cancel if drawn or by refreshing the screen
            if (drawSource === 'draw') {
                els.cancelBtn().classList.add('hidden');
            } else {
                els.cancelBtn().classList.remove('hidden');
            }
        }

        renderGameState();
    } catch (e) {
        console.error('Error loading game state:', e);
    }
}

// ---------- Rendering ----------
function renderGameState() {
    if (!gameState) return;

    els.gameName().textContent = gameState.game_name;
    if (els.roundBadge()) els.roundBadge().textContent = `Round ${gameState.current_round}`;

    els.roleLabel().textContent = isParticipant ? 'Playing as' : 'Spectating as';

    const current = gameState.players.find(p => p.user_id === gameState.current_player_id);
    if (current) els.currentPlayerName().textContent = current.username;

    const isYourTurn = isParticipant && gameState.current_player_id === currentUser.user_id;
    els.yourTurnIndicator().classList.toggle('hidden', !isYourTurn);

    // Piles
    if (!isParticipant) {
        els.drawBtn().disabled = true;
        els.discardBtnPile().disabled = true;
        els.actions().classList.add('hidden');
        els.pendingArea().classList.add('hidden');


        const btn = els.discardBtnPile();
        if (gameState.top_discard_card !== undefined) {
            btn.innerHTML = renderFaceUpCard(gameState.top_discard_card, 'h-full');
        } else {
            btn.innerHTML = renderFaceDownCard('h-full');
        }
        els.drawCount().textContent = `${gameState.draw_pile_count} cards`;
    } else {

        els.drawCount().textContent = `${gameState.draw_pile_count} cards`;
        els.drawBtn().disabled = !isYourTurn || drawnCard !== null;

        const btn = els.discardBtnPile();

        if (gameState.top_discard_card !== undefined) {
            btn.innerHTML = renderFaceUpCard(gameState.top_discard_card, 'h-full'); // show both on the corner and circle
            btn.disabled = !isYourTurn || drawnCard !== null;
        } else {
            btn.innerHTML = renderFaceDownCard('h-full');
            btn.disabled = true;
        }


        // pending card will still be shown if no action taken yet
        if (drawnCard !== null) {
            els.pendingArea().classList.remove('hidden');
            els.pendingCard().innerHTML =
                drawnCard === 'pending'
                    ? renderFaceDownCard('h-full')   
                    : renderFaceUpCard(drawnCard, 'h-full');

            els.actions().classList.remove('hidden');

            // you cant discard a card after drawing from discard pile to count for your turn
            if (drawSource === 'discard') {
                els.discardBtnAction().classList.add('hidden');
            } else {
                els.discardBtnAction().classList.remove('hidden');
            }
        } else {
            els.pendingArea().classList.add('hidden');
            els.actions().classList.add('hidden');
        }
    }

    // This is where your cards go
    if (!isParticipant) {
        els.yourCardsWrap().classList.add('hidden');
    } else {
        els.yourCardsWrap().classList.remove('hidden');
        renderYourCards();
    }

    renderOtherPlayers();

   // leave game, back to lobby buttons
    if (isParticipant) {
        els.leaveGameBtn().classList.remove('hidden');
        els.backToLobbyBtn().classList.remove('hidden');
        els.leaveGameBtn().textContent = isHost ? 'Leave / Delete Game' : 'Leave Game';
    } else {
        els.leaveGameBtn().classList.add('hidden');
        els.backToLobbyBtn().classList.remove('hidden');
    }
    updateChatUI();
}

function renderYourCards() {
    const container = els.yourCards();
    const cards = (gameState.your_cards || []).slice();

    cards.sort((a, b) => (a.position_row - b.position_row) || (a.position_col - b.position_col));

    const isYourTurn = isParticipant && gameState.current_player_id === currentUser.user_id;

    container.innerHTML = cards.map(card => {
        const canFlip = isYourTurn && !card.is_face_up && drawnCard === null;
        const canSwap = isYourTurn && drawnCard !== null;

        const clickHandler = canFlip
            ? `flipCard(${card.position_row}, ${card.position_col})`
            : (canSwap ? `swapCard(${card.position_row}, ${card.position_col})` : '');

        const pointer = canFlip || canSwap ? 'cursor-pointer hover:scale-105' : '';

        const cardHTML = renderCard(card.card_value, card.is_face_up, 'h-32', 'self');
        return `
        <div class="card ${card.is_face_up ? 'face-up' : 'face-down'} ${pointer}"
            data-row="${card.position_row}"
            data-col="${card.position_col}"
            onclick="${clickHandler}">
            ${cardHTML}
        </div>
        `;

    }).join('');

    // only face up cards count
    const score = calculateScore(cards);
    els.yourScore().textContent = score;
}

function renderOtherPlayers() {
    const container = els.otherPlayers();
    const others = gameState.players
        .filter(p => p.user_id !== currentUser.user_id)
        .filter(p => p.is_active === true);

    container.innerHTML = others.map(player => {
        const cards = (gameState.other_players_cards[player.user_id] || []).slice();
        cards.sort((a, b) => (a.position_row - b.position_row) || (a.position_col - b.position_col));
        const score = calculateScore(cards);
        const isCurrent = player.user_id === gameState.current_player_id;

        let pendingHTML = '';
        if (player.pending_card_value !== null && player.pending_card_value !== undefined) {
            pendingHTML = `
                <div class="mt-2 text-center">
                    <div class="text-xs text-gray-500 mb-1">Pending Draw</div>
                    ${renderFaceUpCard(player.pending_card_value, 'h-20')}
                </div>
            `;
        }

        return `
        <div class="bg-white rounded-lg shadow-lg p-4 ${isCurrent ? 'ring-2 ring-green-500' : ''}">
            <div class="flex justify-between items-center mb-3">
                <h4 class="font-bold text-gray-800">${escapeHtml(player.username)}</h4>
                <span class="text-sm text-gray-600">
                    Score: <span class="font-bold">${score}</span>
                </span>
            </div>
            <div class="grid grid-cols-3 gap-2">
                ${cards.map(card => renderCard(card.card_value, card.is_face_up, 'h-20', 'public')).join('')}
            </div>
            ${pendingHTML}
        </div>
        `;
    }).join('');
}


function updateChatUI() {
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    const sendBtn = form.querySelector('button[type="submit"]');

    if (!isParticipant) {
        input.disabled = true;
        sendBtn.disabled = true;
        input.placeholder = 'Spectators cannot chat';
        form.dataset.disabled = 'true';
    } else {
        input.disabled = false;
        sendBtn.disabled = false;
        input.placeholder = 'Type a message...';
        delete form.dataset.disabled;
    }
}

// ----------------- Scoring/ values ----------

// -------------------- Actions ----------

document.getElementById('drawPileBtn').addEventListener('click', async () => {
    if (drawnCard !== null) return;
    try {
        const resp = await fetch(`/api/games/${gameId}/peek`, { method: 'POST' });
        if (!resp.ok) {
            const data = await resp.json();
            return alert(data.error || 'Failed to draw');
        }
        const { card_value } = await resp.json();

        drawSource = 'draw';
        drawnCard = card_value;
        els.actions().classList.remove('hidden');
        els.drawBtn().disabled = true;
        els.discardBtnPile().disabled = true;

        // the pending card will be shown in its own area, called pending area
        els.pendingArea().classList.remove('hidden');
        els.pendingCard().innerHTML = renderFaceUpCard(card_value, 'h-full');

        // hide the cancel button when drawn from the draw pile 
        els.discardBtnAction().classList.remove('hidden');
        els.cancelBtn().classList.add('hidden');

        renderYourCards();
    } catch (e) {
        console.error(e);
        alert('Failed to draw from deck');
    }
});

// Draw from discard pile (must swap or cancel only)
document.getElementById('discardPileBtn').addEventListener('click', () => {
    if (drawnCard !== null) return;

    drawSource = 'discard';
    drawnCard = gameState.top_discard_card;

    els.actions().classList.remove('hidden');
    els.drawBtn().disabled = true;
    els.discardBtnPile().disabled = true;

    els.pendingArea().classList.remove('hidden');
    els.pendingCard().innerHTML = renderFaceUpCard(drawnCard, 'h-full');

    els.discardBtnAction().classList.add('hidden');


    els.cancelBtn().classList.remove('hidden');

    renderYourCards(); 
});

// Swap button (hint only)
document.getElementById('swapBtn').addEventListener('click', () => {
    alert('Click on one of your cards to swap with the drawn card');
});


document.getElementById('discardBtn').addEventListener('click', async () => {
    try {
        const response = await fetch(`/api/games/${gameId}/play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: drawSource, action: 'discard' })
        });

        if (!response.ok) {
            const data = await response.json();
            return alert(data.error || 'Failed to discard card');
        }

        // clear pending/draw
        drawnCard = null;
        drawSource = null;
        els.actions().classList.add('hidden');
        els.pendingArea().classList.add('hidden');

        // re-enable piles
        els.drawBtn().disabled = false;
        if (gameState.top_discard_card !== undefined) {
            els.discardBtnPile().disabled = false;
        }

        renderYourCards();
    } catch (e) {
        console.error('Error discarding card:', e);
        alert('Failed to discard card');
    }
});

document.getElementById('cancelBtn').addEventListener('click', () => {
    drawnCard = null;
    drawSource = null;

    els.actions().classList.add('hidden');
    els.pendingArea().classList.add('hidden');

    els.drawBtn().disabled = false;
    if (gameState.top_discard_card !== undefined) {
        els.discardBtnPile().disabled = false;
    }


    renderYourCards();


    els.cancelBtn().classList.remove('hidden');
});



async function flipCard(row, col) {
    try {
        const r = await fetch(`/api/games/${gameId}/play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'draw', action: 'flip', position: { row, col } })
        });

        if (!r.ok) {
            const data = await r.json();
            alert(data.error || 'Failed to flip card');
        }
    } catch (e) {
        console.error('Error flipping card:', e);
        alert('Failed to flip card');
    }
}


async function swapCard(row, col) {
    try {
        const r = await fetch(`/api/games/${gameId}/play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: drawSource, action: 'swap', position: { row, col } })
        });

        if (!r.ok) {
            const data = await r.json();
            return alert(data.error || 'Failed to swap card');
        }


        drawnCard = null;
        drawSource = null;
        els.actions().classList.add('hidden');
        els.pendingArea().classList.add('hidden');

        els.drawBtn().disabled = false;
        if (gameState.top_discard_card !== undefined) {
            els.discardBtnPile().disabled = false;
        }

        renderYourCards();
    } catch (e) {
        console.error('Error swapping card:', e);
        alert('Failed to swap card');
    }
}

// Navigation back to lobby
document.getElementById('backToLobbyBtn').addEventListener('click', () => {
    window.location.href = '/lobby';
});

// Leave game
document.getElementById('leaveGameBtn').addEventListener('click', async () => {
    if (isHost) {
        if (!confirm('Are you sure you want to leave? This will DELETE the game and send everyone back to the lobby.')) return;
        try {
            const r = await fetch(`/api/games/${gameId}`, { method: 'DELETE' });
            if (r.status === 204) window.location.href = '/lobby';
            else {
                const data = await r.json();
                alert(data.error || 'Failed to delete game');
            }
        } catch (e) {
            console.error(e);
            alert('Failed to delete game');
        }
    } else {
        if (!confirm('Leave this game and return to the lobby?')) return;
        try {
            const r = await fetch(`/api/games/${gameId}/leave`, { method: 'POST' });
            if (r.ok) window.location.href = '/lobby';
            else {
                const data = await r.json();
                alert(data.error || 'Failed to leave game');
            }
        } catch (e) {
            console.error(e);
            alert('Failed to leave game');
        }
    }
});

// ---------- Chat ----------
async function loadChatMessages() {
    try {
        const r = await fetch(`/api/chat/games/${gameId}`);
        if (!r.ok) return;
        const data = await r.json();
        data.messages.forEach(m => addChatMessage(m, false));
    } catch (e) {
        console.error('Error loading chat messages:', e);
    }
}

function addChatMessage(message, scroll = true) {
    const chatMessages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'bg-white rounded-lg p-2 shadow-sm';
    const isOwn = currentUser && message.user_id === currentUser.user_id;
    div.innerHTML = `
        <div class="flex justify-between items-start mb-1">
            <span class="font-semibold text-xs ${isOwn ? 'text-green-600' : 'text-gray-800'}">
                ${escapeHtml(message.username)}
            </span>
            <span class="text-xs text-gray-500">
                ${formatTime(message.created_at)}
            </span>
        </div>
        <p class="text-gray-700 text-sm">
            ${escapeHtml(message.message)}
        </p>
    `;
    chatMessages.appendChild(div);
    if (scroll) chatMessages.scrollTop = chatMessages.scrollHeight;
}



document.getElementById('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!isParticipant) return; // spectators cannot send
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('game:chat:send', { gameId, message: msg });
    input.value = '';
});

// ----------------- Sockets ------------
socket.on('connect', () => {
    console.log('Connected to server (game page)');
    socket.emit('game:join', gameId);
});

socket.on('game:state:update', (updatedState) => {
    gameState = updatedState;
    // recompute participant flag in case someone was removed/added
    isParticipant = !!gameState.players.find(
        p => p.user_id === currentUser.user_id && p.is_active === true
    );
    renderGameState();
});

// “dirty” refetch
socket.on('game:state:dirty', () => {
    loadGameState();
});

socket.on('game:deleted', () => {
    window.location.href = '/lobby';
});

socket.on('game:hand:update', (cards) => {
    if (gameState) {
        gameState.your_cards = cards;
        renderYourCards();
    }
});

socket.on('game:turn:changed', (currentPlayerId) => {
    if (gameState) {
        gameState.current_player_id = currentPlayerId;
        drawnCard = null;
        drawSource = null;
        renderGameState();
    }
});

socket.on('game:round:ended', () => {
    alert('Round ended! Redirecting to results...');
    setTimeout(() => window.location.href = `/results/${gameId}`, 800);
});

socket.on('game:chat:message', (message) => addChatMessage(message));

socket.on('error', (message) => {
    console.error('Socket error:', message);
    alert(message);
});

// Init
getCurrentUser()
    .then(() => loadGameState())
    .then(() => loadChatMessages());

// Cleaning up
window.addEventListener('beforeunload', () => {
    socket.emit('game:leave', gameId);
});
