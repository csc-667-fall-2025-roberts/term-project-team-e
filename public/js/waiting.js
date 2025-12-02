
const socket = io();

let currentUser = null;
let gameId = null;
let gameState = null;
let isHost = false;

function getGameId() {
    const pathParts = window.location.pathname.split('/');
    return parseInt(pathParts[pathParts.length - 1]);
}

gameId = getGameId();

async function getCurrentUser() {
    try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            document.getElementById('username').textContent = currentUser.username;
        } else {
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Error getting current user:', error);
        window.location.href = '/';
    }
}


async function loadGameState() {
    try {
        const response = await fetch(`/api/games/${gameId}/state`);
        if (response.ok) {
            const data = await response.json();
            gameState = data.gameState;

            if (gameState.status === 'playing') {
                window.location.href = `/games/${gameId}`;
                return;
            }

            if (gameState.status === 'results') {
                window.location.href = `/results/${gameId}`;
                return;
            }

            const hostPlayer = gameState.players.find(p => p.user_id === currentUser.user_id);
            isHost = hostPlayer && gameState.players[0].user_id === currentUser.user_id;

            renderGameState();
        } else {
            showStatus('Game not found', 'error');
            setTimeout(() => {
                window.location.href = '/lobby';
            }, 2000);
        }
    } catch (error) {
        console.error('Error loading game state:', error);
        showStatus('Failed to load game', 'error');
    }
}

function renderGameState() {

    document.getElementById('gameName').textContent = gameState.game_name;

    
    if (isHost) {
        document.getElementById('editNameToggleBtn').classList.remove('hidden');
        document.getElementById('startGameBtn').classList.remove('hidden');
    }

    
    const activePlayers = gameState.players.filter(p => p.is_active);
    document.getElementById('playerCount').textContent = activePlayers.length;

    
    const startBtn = document.getElementById('startGameBtn');
    if (activePlayers.length >= 2) {
        startBtn.disabled = false;
    } else {
        startBtn.disabled = true;
    }


    const playersList = document.getElementById('playersList');
    playersList.innerHTML = activePlayers.map((player, index) => `
        <div class="bg-gray-50 rounded-lg p-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white font-bold">
                    ${index + 1}
                </div>
                <div>
                    <p class="font-semibold text-gray-800">${escapeHtml(player.username)}</p>
                    ${index === 0 ? '<span class="text-xs text-green-600 font-semibold">👑 Host</span>' : ''}
                </div>
            </div>
            <div class="flex items-center gap-3">
            ${player.user_id === currentUser.user_id ? '<span class="text-sm text-blue-600 font-semibold">You</span>' : ''}
            ${isHost && player.user_id !== currentUser.user_id
                ? `<button data-kick="${player.user_id}" class="text-sm bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded-lg transition">Kick</button>`
                : ''}
            </div>
        </div>
    `).join('');

    
    document.querySelectorAll('[data-kick]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const targetId = parseInt(btn.getAttribute('data-kick'));
            if (!confirm('Kick this player? They will not be able to rejoin this waiting room.')) return;
            try {
                const r = await fetch(`/api/games/${gameId}/kick`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: targetId })
                });
                if (r.status !== 204) {
                    const data = await r.json();
                    showStatus(data.error || 'Failed to kick player', 'error');
                } else {
                    showStatus('Player removed', 'success');
                }
            } catch (e) {
                console.error(e);
                showStatus('Failed to kick player', 'error');
            }
        });
    });

}


function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.textContent = message;
    statusDiv.className = `mt-4 p-3 rounded-lg ${type === 'error' ? 'bg-red-100 text-red-700' :
        type === 'success' ? 'bg-green-100 text-green-700' :
            'bg-blue-100 text-blue-700'
        }`;
    statusDiv.classList.remove('hidden');

    setTimeout(() => {
        statusDiv.classList.add('hidden');
    }, 5000);
}



async function loadChatMessages() {
    try {
        // initially had it as /api/games/:id/ and treated it as round 0 but now  made a separate endpoint for waiting room chat

        const r = await fetch(`/api/chat/waiting/${gameId}`);
        if (!r.ok) return;
        const data = await r.json();
        data.messages.forEach(msg => addChatMessage(msg, false));
    } catch (err) {
        console.error("Failed to load waiting chat:", err);
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
            <span class="text-xs text-gray-500">
                ${formatTime(message.created_at)}
            </span>
        </div>
        <p class="text-gray-700 text-sm">${escapeHtml(message.message)}</p>
    `;

    chatMessages.appendChild(messageDiv);

    if (scroll) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}




document.getElementById('backToLobbyBtn').addEventListener('click', () => {
    window.location.href = '/lobby';
});


document.getElementById('leaveGameBtn').addEventListener('click', async () => {
    if (isHost) {
        if (!confirm('End this game for everyone and return all players to the lobby?')) return;
        try {
            const r = await fetch(`/api/games/${gameId}`, { method: 'DELETE' });
            if (r.status === 204) {
                // We’ll also receive game:deleted via socket, but redirect defensively:
                window.location.href = '/lobby';
            } else {
                const data = await r.json();
                showStatus(data.error || 'Failed to delete game', 'error');
            }
        } catch (e) {
            console.error(e);
            showStatus('Failed to delete game', 'error');
        }
    } else {
        if (!confirm('Leave the waiting room? You can resume from the lobby later.')) return;
        try {
            const response = await fetch(`/api/games/${gameId}/leave`, { method: 'POST' });
            if (response.ok) {
                window.location.href = '/lobby';
            } else {
                const data = await response.json();
                showStatus(data.error || 'Failed to leave game', 'error');
            }
        } catch (error) {
            console.error('Error leaving game:', error);
            showStatus('Failed to leave game', 'error');
        }
    }
});


document.getElementById('startGameBtn').addEventListener('click', async () => {
    try {
        const response = await fetch(`/api/games/${gameId}/start`, {
            method: 'POST'
        });

        if (response.ok) {
            showStatus('Starting game...', 'success');
            // Will be redirected by socket event
        } else {
            const data = await response.json();
            showStatus(data.error || 'Failed to start game', 'error');
        }
    } catch (error) {
        console.error('Error starting game:', error);
        showStatus('Failed to start game', 'error');
    }
});


document.getElementById('editNameToggleBtn').addEventListener('click', () => {
    const editSection = document.getElementById('editNameSection');
    const newNameInput = document.getElementById('newGameName');

    editSection.classList.toggle('hidden');
    if (!editSection.classList.contains('hidden')) {
        newNameInput.value = gameState.game_name;
        newNameInput.focus();
    }
});

// 
document.getElementById('cancelEditBtn').addEventListener('click', () => {
    document.getElementById('editNameSection').classList.add('hidden');
});

// 
document.getElementById('updateNameBtn').addEventListener('click', async () => {
    const newName = document.getElementById('newGameName').value.trim();

    if (!newName) {
        showStatus('Game name cannot be empty', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/games/${gameId}/name`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ game_name: newName })
        });

        if (response.ok) {
            document.getElementById('editNameSection').classList.add('hidden');
            showStatus('Game name updated', 'success');
            // Will be updated by socket event
        } else {
            const data = await response.json();
            showStatus(data.error || 'Failed to update name', 'error');
        }
    } catch (error) {
        console.error('Error updating game name:', error);
        showStatus('Failed to update name', 'error');
    }
});

// 
document.getElementById('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();

    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    socket.emit('waiting:chat:send', { gameId, message });

    input.value = '';
});


gameId = getGameId();

//
socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('game:join', gameId);
});


socket.on('game:state:update', (updatedState) => {
    gameState = updatedState;
    renderGameState();
});

/// -----------------------------
socket.on('game:state:dirty', () => {
    loadGameState();
});

socket.on('game:deleted', () => {

    window.location.href = '/lobby';
});

/// -----------------------------

socket.on('game:player:joined', (player) => {
    showStatus(`${player.username} joined the game`, 'info');
    loadGameState();
});

socket.on('game:player:left', (userId) => {
    const player = gameState.players.find(p => p.user_id === userId);
    if (player) {
        showStatus(`${player.username} left the game`, 'info');
    }
    loadGameState();
});

socket.on('game:kicked', (data) => {
    if (data.game_id === gameId && currentUser && data.user_id === currentUser.user_id) {
        alert('You were removed by the host and cannot rejoin this waiting room.');
        window.location.href = '/lobby';
        return;
    }

    // update game state
    loadGameState();
});


socket.on('game:started', (data) => {
    
    window.location.href = `/games/${data.gameId}`;
});


// socket.on('game:chat:message', (message) => {
//     addChatMessage(message);
// });

socket.on('error', (message) => {
    console.error('Socket error:', message);
    showStatus(message, 'error');
});

socket.on('waiting:chat:message', (msg) => {
    addChatMessage(msg);
});



getCurrentUser().then(() => {
    loadGameState();
    loadChatMessages();
});

// Cleanup on 
window.addEventListener('beforeunload', () => {
    socket.emit('game:leave', gameId);
});