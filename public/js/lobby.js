// Initialize Socket.IO
const socket = io();

let currentUser = null;
let games = [];


async function getCurrentUser() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) throw new Error('status ' + response.status);
        const data = await response.json();

        if (data.authenticated && data.user) {
            currentUser = data.user;
            document.getElementById('username').textContent = currentUser.username;
        } else {
            location.replace('/');
        }
    } catch (error) {
        console.error('Error getting current user:', error);
        location.replace('/');
    }
}


async function loadGames() {
    try {
        const response = await fetch('/api/games');
        if (response.ok) {
            const data = await response.json();
            games = data.games;
            renderGames();
        }
    } catch (error) {
        console.error('Error loading games:', error);
    }
}

// game lists
function renderGames() {
    const gamesList = document.getElementById('gamesList');
    const emptyState = document.getElementById('emptyState');

    if (games.length === 0) {
        gamesList.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    gamesList.innerHTML = games.map(game => `
        <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="text-xl font-bold text-gray-800">
                    ${escapeHtml(game.game_name)}
                    ${game.requires_code ? '<span title="Join code required" class="ml-2 text-sm">🔒</span>' : ''}
                    </h3>

                    <p class="text-sm text-gray-600">Host: ${escapeHtml(game.host_username)}</p>
                </div>

                <span class="px-3 py-1 rounded-full text-sm font-semibold ${game.status === 'waiting'
            ? 'bg-yellow-100 text-yellow-800'
            : game.status === 'playing'
                ? 'bg-green-100 text-green-800'
                : 'bg-blue-100 text-blue-800'
        }">
                ${game.status === 'waiting' ? 'Waiting' : game.status === 'playing' ? 'Playing' : 'Results'}
                </span>

            </div>
            <div class="flex justify-between items-center mt-4">
                <span class="text-gray-600">
                    👥 ${game.player_count} player${game.player_count !== 1 ? 's' : ''}
                </span>
                ${renderGameButton(game)}
            </div>
        </div>
    `).join('');


    games.forEach(game => {
        const btn = document.getElementById(`game-btn-${game.game_id}`);
        if (btn) {
            btn.addEventListener('click', () => handleGameAction(game));
        }
    });
}


function renderGameButton(game) {
    // Already active participant
    if (game.is_participant) {
        if (game.status === 'waiting') {
            return `
                <button id="game-btn-${game.game_id}" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition">
                    Resume Waiting Room
                </button>
            `;
        } else {
            return `
                <button id="game-btn-${game.game_id}" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition">
                    Go to Game
                </button>
            `;
        }
    }


    if (game.can_resume_waiting && game.status === 'waiting') {
        return `
            <button id="game-btn-${game.game_id}" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition">
                Join Waiting Room
            </button>
        `;
    }


    if (game.can_join) {
        return `
            <button id="game-btn-${game.game_id}" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition">
                Join Waiting Room
            </button>
        `;
    }


    if (game.can_spectate) {
        return `
            <button id="game-btn-${game.game_id}" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition">
                Spectate
            </button>
        `;
    }


    return '';
}




async function handleGameAction(game) {

    if (game.is_participant) {
        if (game.status === 'waiting') window.location.href = `/waiting/${game.game_id}`;
        else window.location.href = `/games/${game.game_id}`;
        return;
    }


    if (game.can_resume_waiting && game.status === 'waiting') {
        try {
            const r = await fetch(`/api/games/${game.game_id}/join`, { method: 'POST' });
            const data = r.ok ? null : await r.json();
            if (!r.ok) return alert(data.error || 'Failed to join waiting room');
            window.location.href = `/waiting/${game.game_id}`;
        } catch (e) {
            console.error(e);
            alert('Failed to join waiting room');
        }
        return;
    }


    if (game.can_join) {
        try {
            let payload = {};
            if (game.requires_code) {
                const code = prompt('This game requires a join code:');
                if (!code) return;
                payload.code = code.trim();
            }
            const r = await fetch(`/api/games/${game.game_id}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = r.ok ? null : await r.json();
            if (!r.ok) return alert(data.error || 'Failed to join game');
            window.location.href = `/waiting/${game.game_id}`;
        } catch (e) {
            console.error(e);
            alert('Failed to join game');
        }
        return;
    }



    if (game.can_spectate) {
        window.location.href = `/games/${game.game_id}`;
        return;
    }

}


async function loadChatMessages() {
    try {
        const response = await fetch('/api/chat/lobby');
        if (response.ok) {
            const data = await response.json();
            data.messages.forEach(msg => addChatMessage(msg, false));
        }
    } catch (error) {
        console.error('Error loading chat messages:', error);
    }
}


function addChatMessage(message, scroll = true) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'bg-white rounded-lg p-3 shadow-sm';

    const isOwnMessage = currentUser && message.user_id === currentUser.user_id;

    messageDiv.innerHTML = `
        <div class="flex justify-between items-start mb-1">
            <span class="font-semibold text-sm ${isOwnMessage ? 'text-green-600' : 'text-gray-800'}">
                ${escapeHtml(message.username)}
            </span>
            <span class="text-xs text-gray-500">${formatTime(message.created_at)}</span>
        </div>
        <p class="text-gray-700 text-sm">${escapeHtml(message.message)}</p>
    `;

    chatMessages.appendChild(messageDiv);

    if (scroll) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}





document.getElementById('signoutBtn').addEventListener('click', async () => {
    try {
        const r = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        if (r.ok) {
            location.replace('/');
        } else {
            console.error('Logout failed');
        }
    } catch (error) {
        console.error('Error signing out:', error);
    }
});


const createGameModal = document.getElementById('createGameModal');
const createGameBtn = document.getElementById('createGameBtn');
const cancelCreateBtn = document.getElementById('cancelCreateBtn');

createGameBtn.addEventListener('click', () => {
    createGameModal.classList.remove('hidden');
    createGameModal.classList.add('flex');
    document.getElementById('gameName').value = '';
    document.getElementById('createGameError').classList.add('hidden');
});

cancelCreateBtn.addEventListener('click', () => {
    createGameModal.classList.add('hidden');
    createGameModal.classList.remove('flex');
});


const joinModeRadios = document.querySelectorAll('input[name="joinMode"]');
const joinCodeRow = document.getElementById('joinCodeRow');
joinModeRadios.forEach(r => {
    r.addEventListener('change', () => {
        joinCodeRow.classList.toggle('hidden', r.value !== 'code' || !r.checked);
    });
});


document.getElementById('createGameForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const gameName = document.getElementById('gameName').value;
    const errorDiv = document.getElementById('createGameError');
    const joinMode = [...document.querySelectorAll('input[name="joinMode"]')].find(r => r.checked)?.value || 'open';
    const joinCode = document.getElementById('joinCodeInput').value.trim();

    try {
        const response = await fetch('/api/games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_name: gameName,
                join_mode: joinMode,
                join_code: joinMode === 'code' ? joinCode : undefined
            })
        });

        const data = await response.json();

        if (response.ok) {
            createGameModal.classList.add('hidden');
            createGameModal.classList.remove('flex');
            window.location.href = `/waiting/${data.game_id}`;
        } else {
            errorDiv.textContent = data.error || 'Failed to create game';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.remove('hidden');
    }
});


document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();

    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (message) {
        socket.emit('lobby:chat:send', message);
        input.value = '';
    }
});


socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('lobby:join');
});

socket.on('lobby:games:update', (_updatedGames) => {

    loadGames();
});

socket.on('lobby:chat:message', (message) => {
    addChatMessage(message);
});

socket.on('error', (message) => {
    console.error('Socket error:', message);
    alert(message);
});

getCurrentUser().then(() => {
    loadGames();
    loadChatMessages();
});


window.addEventListener('beforeunload', () => {
    socket.emit('lobby:leave');
});