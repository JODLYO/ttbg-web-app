const MAX_PLAYERS = 6;
const POLL_INTERVAL = 3000;
const INACTIVE_TIMEOUT = 1 * 60 * 1000;
const lobbyId = document.getElementById('lobby-id').dataset.lobbyId;
const readyUrl = document.getElementById('ready-form-container').dataset.readyUrl;
const currentUsername = document.getElementById('current-player').dataset.username;
const lobbyStatusUrl = document.getElementById('lobby-id').getAttribute('data-lobby-status-url');
const gameUrlTemplate = document.getElementById("game-url").dataset.readyUrl;

function getGameUrl(gameStateId) {
    return gameUrlTemplate.replace(/0\/$/, gameStateId + "/");
}

function updateLobbyStatus(data) {
    if (data.error === "Lobby not found") {
        alert("This lobby has been closed due to inactivity. Redirecting to home...");
        window.location.href = '/';
        return;
    }

    updatePlayerList(data.players);
    updateLobbyUI(data);

    if (data.is_full && data.all_ready && data.game_state_id) {
        window.location.href = `/game/${data.game_state_id}/`;
    }
}

function updatePlayerList(players) {
    const playersDiv = document.getElementById('players');
    playersDiv.innerHTML = '';

    const now = new Date();
    players.forEach(player => {
        const playerElement = document.createElement('div');
        const lastActivity = new Date(player.last_activity);
        const inactiveTime = (now - lastActivity) / 1000;

        const inactiveWarning = inactiveTime > INACTIVE_TIMEOUT / 1000 ? ' (Inactive)' : '';
        playerElement.classList.add('player-card');
        if (player.ready) playerElement.classList.add('player-ready');

        playerElement.innerHTML = `
            <span class="player-name">${player.username}${inactiveWarning}</span>
            <span class="player-status ${player.ready ? 'status-ready' : 'status-waiting'}">
                ${player.ready ? 'Ready' : 'Waiting'}
            </span>
        `;
        playersDiv.appendChild(playerElement);
    });
}

function updateLobbyUI(data) {
    const waitingMessageDiv = document.getElementById('waiting-message');
    const readyButtonDiv = document.getElementById('ready-button');
    const playerCountDiv = document.getElementById('player-count');
    const readyPlayers = data.players.filter(player => player.ready).length;

    if (playerCountDiv) {
        playerCountDiv.textContent = `${data.players.length}/${MAX_PLAYERS} Players`
            + (data.players.length >= 2 ? ` - (${readyPlayers}/${data.players.length} Ready)` : "");
    }

    if (data.players.length === 1) {
        waitingMessageDiv.style.display = 'block';
        readyButtonDiv.innerHTML = '';
    } else {
        waitingMessageDiv.style.display = 'none';

        if (!data.all_ready) {
            readyButtonDiv.innerHTML = `
                <button id="ready-button-submit" class="game-button">I'm Ready</button>
            `;
            document.getElementById('ready-button-submit').addEventListener('click', () => {
                setReady(true);
            });
        } else {
            readyButtonDiv.innerHTML = '';
        }
    }
}

function fetchLobbyStatus() {
    fetch(lobbyStatusUrl)
        .then(response => response.json())
        .then(data => {
            if (data.game_state_id) {
                window.location.href = getGameUrl(data.game_state_id);
            } else {
                updateLobbyStatus(data);
            }
        })
        .catch(error => {
            console.error('Error fetching lobby status:', error);
            alert("Connection lost. The lobby may have been closed. Redirecting to home...");
            window.location.href = '/';
        });
}

function setReady(readyState = true) {
    const btn = document.getElementById('ready-button-submit');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Locked In ✦';
    }
    fetch(`/set-game/api/lobby_status/${lobbyId}/ready/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        credentials: 'include',
        body: JSON.stringify({ ready: readyState })
    })
        .then(r => r.json())
        .then(() => {
            // Fetch the full lobby status after marking ready
            return fetch(lobbyStatusUrl)
                .then(r => r.json())
                .then(updateLobbyStatus)
                .catch(err => console.error("Error updating lobby after ready:", err));
        })
        .catch(err => console.error("Error setting ready:", err));
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

setInterval(fetchLobbyStatus, POLL_INTERVAL);
fetchLobbyStatus();

// reload on pageshow so the displayed username/board is always current
window.addEventListener('pageshow', function (event) {
    if (event.persisted || window.performance && window.performance.navigation.type === 2) {
        window.location.reload();
    }
});