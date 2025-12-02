
const socket = io();

let currentUser = null;
let gameId = null;
let gameState = null;
let roundScores = [];
let isActiveParticipant = false;
let isHost = false;

let hostUserId = null;


let statusIsResults = false;

function getGameId() {
    const parts = window.location.pathname.split('/');
    return parseInt(parts[parts.length - 1], 10);
}

// -------------- Auth -----------
async function getCurrentUser() {
    const r = await fetch('/api/auth/me');
    if (!r.ok) return (window.location.href = '/');
    const data = await r.json();
    currentUser = data.user;
    document.getElementById('username').textContent = currentUser.username;
}

// --------------- Load Results  ---------------
async function loadGameResults() {
    const r = await fetch(`/api/games/${gameId}/state`);
    if (!r.ok) { alert('Failed to load results'); return (window.location.href = '/lobby'); }
    const data = await r.json();
    gameState = data.gameState;


    statusIsResults = gameState.status === 'results';

    document.getElementById('gameName').textContent = gameState.game_name;
    document.getElementById('roundNumber').textContent = gameState.current_round;

    hostUserId = gameState.host_user_id;
    isHost = currentUser.user_id === hostUserId;

    const me = gameState.players.find(p => p.user_id === currentUser.user_id);
    isActiveParticipant = !!me && !!me.is_active;

    const playBtn = document.getElementById('playAgainBtn');
    const beginBtn = document.getElementById('beginBtn');
    const backBtn = document.getElementById('backToLobbyBtn');
    const playersReady = document.getElementById('playersReady');

    if (isActiveParticipant) {
        playBtn.classList.remove('hidden');
        backBtn.textContent = 'Leave Game';
        playersReady.classList.remove('hidden');
    } else {
        playBtn.classList.add('hidden');
        backBtn.textContent = 'Back to Lobby';
        playersReady.classList.add('hidden');
    }

    if (isHost) beginBtn.classList.remove('hidden');
    else beginBtn.classList.add('hidden');

    await loadRoundScores();
    await loadOverallScores();
    await renderLeftPlayers();
    renderPlayerCards();
    await refreshReadyStatus(); // will enable after certiain amount
}

// -------------=--- Round scores -----------------
async function loadRoundScores() {
    try {
        
        const r = await fetch(`/api/games/${gameId}/round/${gameState.current_round}/scores`);
        if (!r.ok) throw new Error('round scores');
        const data = await r.json();

        const scores = data.scores.map(s => {
            const cards = (s.user_id === currentUser.user_id)
                ? (gameState.your_cards || [])
                : (gameState.other_players_cards?.[s.user_id] || []);
            return {
                user_id: s.user_id,
                username: s.username,
                score: s.score,
                cards
            };
        });

        // the user with the lowest score wins
        
        scores.sort((a, b) => a.score - b.score);

        roundScores = scores;
        renderRoundScores(scores);
        renderPlayerCards();
    } catch (e) {
        console.error('Error loading round scores:', e);

        const playersWithCards = (gameState.players || []).map(p => {
            const cards = (p.user_id === currentUser.user_id)
                ? (gameState.your_cards || [])
                : (gameState.other_players_cards?.[p.user_id] || []);
            return { ...p, cards };
        }).filter(p => (p.cards && p.cards.length > 0));

        roundScores = playersWithCards.map(p => ({
            user_id: p.user_id,
            username: p.username,
            score: undefined,
            cards: p.cards
        }));

        renderRoundScores([]); 
        renderPlayerCards();
    }
}

// ---------- Overall leaderboard --------------
async function loadOverallScores() {
    try {
        const r = await fetch(`/api/games/${gameId}/leaderboard`);
        if (!r.ok) throw new Error('leaderboard');
        const { leaderboard } = await r.json();
        leaderboard.sort((a, b) => a.total - b.total);
        const scores = leaderboard.map(e => ({ user_id: e.user_id, username: e.username, score: e.total }));
        renderOverallScores(scores);
    } catch (e) {
        console.error('Error loading overall scores:', e);
        renderOverallScores(roundScores);
    }
}

// ------ Players who left ----------
async function renderLeftPlayers() {
    try {
        const r = await fetch(`/api/games/${gameId}/left`);
        if (!r.ok) return;
        const { left } = await r.json();


        const filtered = (left || []).filter(l => l.left_at_round != null);

        renderPlayerCards.__leftHTML = filtered.length ? `
            <div class="col-span-full">
                <div class="border-2 border-red-300 rounded-lg p-4 mt-6">
                    <h4 class="font-bold text-red-700 mb-3">Players who left</h4>
                    <div class="space-y-2">
                        ${filtered.map(l => `
                        <div class="flex items-center justify-between bg-red-50 rounded p-2">
                            <div>
                                <p class="font-semibold text-red-800">${escapeHtml(l.username)}</p>
                                <p class="text-xs text-red-700">Left at round ${l.left_at_round}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-sm text-red-900">Total: <span class="font-bold">${l.total}</span></p>
                            </div>
                        </div>
                        `).join('')}
                    </div>
                </div>
        </div>
        ` : '';
    } catch (e) {
        console.error('left players load error:', e);
    }
}

// -------- Rendering ------

function renderRoundScores(scores) {
    const container = document.getElementById('roundScores');

    let lastScore = null;
    let lastRank = 0;

    container.innerHTML = scores.map((p, i) => {
        // what if two users are tied?
        let rank;
        if (i === 0) rank = 1;
        else if (p.score === lastScore) rank = lastRank;
        else rank = i + 1;

        lastScore = p.score;
        lastRank = rank;

        const medal =
            rank === 1 ? '🥇' :
            rank === 2 ? '🥈' :
            rank === 3 ? '🥉' : '';

        const isMe = p.user_id === currentUser.user_id;


        const tieLabel =
            (i > 0 && p.score === scores[i - 1].score)
                ? '<p class="text-xs text-yellow-600 font-semibold">Tied</p>'
                : '';

        return `
            <div class="flex items-center justify-between p-4 rounded-lg ${isMe ? 'bg-green-50 border-2 border-green-500' : 'bg-gray-50'}">
                <div class="flex items-center gap-4">
                    <span class="text-2xl font-bold text-gray-400">#${rank}</span>
                    <span class="text-2xl">${medal}</span>
                    <div>
                        <p class="font-bold text-gray-800">${escapeHtml(p.username)}</p>
                        ${tieLabel}
                        ${isMe ? '<p class="text-xs text-green-600">You</p>' : ''}
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-3xl font-bold ${p.score < 0 ? 'text-green-600' : 'text-gray-800'}">${p.score}</p>
                    <p class="text-xs text-gray-500">points</p>
                </div>
            </div>`;
    }).join('');
}

function renderOverallScores(scores) {
    const container = document.getElementById('overallScores');

    let lastScore = null;
    let lastRank = 0;

    container.innerHTML = scores.map((p, i) => {
        
        let rank;
        if (i === 0) rank = 1;
        else if (p.score === lastScore) rank = lastRank;
        else rank = i + 1;

        lastScore = p.score;
        lastRank = rank;

        const isMe = p.user_id === currentUser.user_id;

        const tieLabel =
            (i > 0 && p.score === scores[i - 1].score)
                ? '<p class="text-xs text-yellow-600 font-semibold">Tied</p>'
                : '';

        return `
            <div class="flex items-center justify-between p-4 rounded-lg ${isMe ? 'bg-green-50 border-2 border-green-500' : 'bg-gray-50'}">
                <div class="flex items-center gap-4">
                    <span class="text-2xl font-bold text-gray-400">#${rank}</span>
                    <div>
                        <p class="font-bold text-gray-800">${escapeHtml(p.username)}</p>
                        ${tieLabel}
                        ${isMe ? '<p class="text-xs text-green-600">You</p>' : ''}
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-2xl font-bold ${p.score < 0 ? 'text-green-600' : 'text-gray-800'}">${p.score}</p>
                    <p class="text-xs text-gray-500">total</p>
                </div>
            </div>
        `;
    }).join('');
}

function renderPlayerCards() {
    const container = document.getElementById('playerCards');
    const cardsHtml = roundScores.map(player => {
        const cards = (player.cards || []).slice().sort((a, b) =>
            (a.position_row - b.position_row) || (a.position_col - b.position_col)
        );

        return `
            <div class="border-2 ${player.user_id === currentUser.user_id ? 'border-green-500' : 'border-gray-200'} rounded-lg p-4">
                <h4 class="font-bold text-gray-800 mb-3">${escapeHtml(player.username)}</h4>
                <div class="grid grid-cols-3 gap-2 mb-3">
                    ${cards.map(card => renderCard(card.card_value, true, 'h-20')).join('')}
                </div>
                <div class="text-center">
                    <p class="text-sm text-gray-600">Score: <span class="font-bold text-lg">${player.score ?? '-'}</span></p>
                </div>
            </div>
        `;
        }).join('');

    container.innerHTML = cardsHtml + (renderPlayerCards.__leftHTML || '');
}

// -------- Card UI + display helpers -----------------------------------


function escapeHtml(t) {
    const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
}

// -------- Rematch UI --------
async function refreshReadyStatus() {
    try {
        const r = await fetch(`/api/games/${gameId}/rematch/status`);
        if (!r.ok) return;
        const { ready_count, ready_users } = await r.json();

        document.getElementById('readyCount').textContent = String(ready_count);
        document.getElementById('readyList').innerHTML = ready_users.map(u => `
            <span class="px-3 py-1 rounded-full text-sm bg-green-100 text-green-800">
                ${escapeHtml(u.username)}
            </span>
        `).join('');

        // if host is ready and at least 2 ready total ( and if we are on the results screen obviously )
        if (isHost) {
            const hostReady = ready_users.some(u => u.user_id === hostUserId);
            const beginBtn = document.getElementById('beginBtn');
            beginBtn.disabled = !(statusIsResults && hostReady && ready_count >= 2);
        }
    } catch (e) {
        console.error('refreshReadyStatus error:', e);
    }
}

// if someone clicks on "Play Another Round" it doesnt take them to the game screen yet
document.getElementById('playAgainBtn').addEventListener('click', async () => {
    if (!isActiveParticipant) return;
    try {
        const resp = await fetch(`/api/games/${gameId}/rematch/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yes: true })
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            return alert(data.error || 'Failed to register rematch vote');
        }
        await refreshReadyStatus();
    } catch (e) {
        console.error(e);
        alert('Failed to register rematch vote');
    }
});

// Host clicks Begin to start the next round and its done via /rematch/start
document.getElementById('beginBtn').addEventListener('click', async () => {
    if (!isHost) return;
    const btn = document.getElementById('beginBtn');
    btn.disabled = true;
    try {
        const r = await fetch(`/api/games/${gameId}/rematch/start`, { method: 'POST' });
        if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            alert(data.error || 'Failed to start the next round');
            await refreshReadyStatus();
            return;
        }
        
    } catch (e) {
        console.error(e);
        alert('Failed to start the next round');
        await refreshReadyStatus();
    }
});


document.getElementById('backToLobbyBtn').addEventListener('click', async () => {
    if (!isActiveParticipant) return (window.location.href = '/lobby');
    if (!confirm('Leave this game? You will be moved to the lobby and can only spectate this table.')) return;
    try {
        const r = await fetch(`/api/games/${gameId}/leave`, { method: 'POST' });
        if (r.ok) window.location.href = '/lobby';
        else {
            const data = await r.json().catch(() => ({}));
            alert(data.error || 'Failed to leave game');
        }
    } catch (e) {
        console.error(e);
        alert('Failed to leave game');
    }
});


socket.on('connect', () => {
    console.log('Connected (results)');
    socket.emit('game:join', gameId);
});


socket.on('game:rematch:update', () => {
    refreshReadyStatus();
});

// Host and EVERYONE move to the next round
socket.on('game:started', (data) => {

    window.location.href = `/games/${data.gameId}`;
});


socket.on('game:state:dirty', () => loadGameResults());

// Init
gameId = getGameId();
getCurrentUser().then(loadGameResults);
