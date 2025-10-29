// Web SDK Testing Client
AgoraRTC.setParameter("SHOW_GLOBAL_CLIENT_LIST", true);

// Global state management
let testState = {
    isRunning: false,
    clients: [],
    testTimer: null,
    timeRemaining: 0
};

// Test configuration
let testConfig = {
    appId: '',
    hostsCount: 1,
    audiencesCount: 5,
    channelName: 'TEST',
    audienceType: 'interactive', // interactive|broadcast
    testDuration: 60,
    audienceJoinInterval: 0 // seconds; 0 or empty = immediate joins (current behavior)
};

// Utility: sleep for given milliseconds
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize the testing client
function initializeTestingClient() {
    log('Testing client initialized');
    setupEventListeners();
    setupButtonHandlers();
    updateUI();
}

// Setup event listeners for device changes
function setupEventListeners() {
    AgoraRTC.on('microphone-changed', async (changedDevice) => {
        log(`Audio device changed: ${changedDevice.state} - ${changedDevice.device.label}`);
    });
}

// Setup button event handlers
function setupButtonHandlers() {
    document.getElementById('startTest').onclick = startTest;
    document.getElementById('stopTest').onclick = stopTest;
    document.getElementById('clearLog').onclick = clearLog;
    
    // Update configuration when form changes
    document.getElementById('appId').onchange = updateConfig;
    document.getElementById('hostsCount').onchange = updateConfig;
    document.getElementById('audiencesCount').onchange = updateConfig;
    document.getElementById('channelName').onchange = updateConfig;
    document.getElementById('audienceType').onchange = updateConfig;
    document.getElementById('testDuration').onchange = updateConfig;
    const intervalEl = document.getElementById('audienceJoinInterval');
    if (intervalEl) intervalEl.onchange = updateConfig;
}

// Update configuration from form
function updateConfig() {
    testConfig.appId = document.getElementById('appId').value;
    testConfig.hostsCount = parseInt(document.getElementById('hostsCount').value);
    testConfig.audiencesCount = parseInt(document.getElementById('audiencesCount').value);
    testConfig.channelName = document.getElementById('channelName').value;
    testConfig.audienceType = document.getElementById('audienceType').value;
    testConfig.testDuration = parseInt(document.getElementById('testDuration').value);
    const intervalVal = document.getElementById('audienceJoinInterval')?.value;
    const parsedInterval = intervalVal === '' || intervalVal == null ? 0 : parseFloat(intervalVal);
    testConfig.audienceJoinInterval = isNaN(parsedInterval) ? 0 : Math.max(0, parsedInterval);
}

// Start the test
async function startTest() {
    if (testState.isRunning) {
        log('Test is already running');
        return;
    }
    
    updateConfig();
    
    if (!testConfig.appId) {
        log('Please enter an App ID');
        return;
    }
    
    log('Starting test...');
    testState.isRunning = true;
    testState.timeRemaining = testConfig.testDuration;
    
    updateUI();
    updateStatus('Test Running', 'running');
    
    try {
        // Basic validation and cap total clients at 20
        const totalRequested = (testConfig.hostsCount || 0) + (testConfig.audiencesCount || 0);
        if (totalRequested <= 0) {
            throw new Error('Please configure at least 1 client (host or audience)');
        }
        // Create and join clients for live broadcasting
        await createAndJoinClientsLive();
        
        // Start timer
        startTimer();
        
        const total = (testConfig.hostsCount || 0) + (testConfig.audiencesCount || 0);
        log(`Test started with ${total} clients (hosts: ${testConfig.hostsCount}, audiences: ${testConfig.audiencesCount})`);
    } catch (error) {
        log(`Error starting test: ${error.message}`);
        stopTest();
    }
}

// Create and join multiple clients for live broadcasting
async function createAndJoinClientsLive() {
    testState.clients = [];
    const channel = testConfig.channelName;
    const latencyLevel = testConfig.audienceType === 'interactive' ? 1 : 2;
    const audienceIntervalMs = (testConfig.audienceJoinInterval || 0) * 1000;

    // Create hosts
    for (let i = 0; i < (testConfig.hostsCount || 0); i++) {
        const clientInfo = await createHostClient(i, channel);
        testState.clients.push(clientInfo);
    }

    // Create audiences
    for (let i = 0; i < (testConfig.audiencesCount || 0); i++) {
        const clientInfo = await createAudienceClient(i, channel, latencyLevel);
        testState.clients.push(clientInfo);
        if (audienceIntervalMs > 0 && i < (testConfig.audiencesCount - 1)) {
            await sleep(audienceIntervalMs);
        }
    }

    log(`Created ${testState.clients.length} clients`);
}

// Create a host client in live mode and publish a synthesized audio track
async function createHostClient(index, channelName) {
    const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
    setupClientEventListeners(client, `host-${index}`);
    try {
        const uid = null; // let Agora assign
        await client.join(testConfig.appId, channelName, null, uid);
        await client.setClientRole('host');
        const audioTrack = await createSynthAudioTrack();
        await client.publish([audioTrack]);
        log(`Host ${client.uid} joined channel ${channelName} and published audio`);
        return { client, index: `host-${index}`, uid: client.uid, channelName, localTracks: [audioTrack] };
    } catch (error) {
        log(`Error creating host ${index}: ${error.message}`);
        throw error;
    }
}

// Create an audience client in live mode with specified latency
async function createAudienceClient(index, channelName, latencyLevel) {
    const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
    setupClientEventListeners(client, `aud-${index}`);
    try {
        const uid = null;
        await client.join(testConfig.appId, channelName, null, uid);
        await client.setClientRole('audience', { level: latencyLevel });
        log(`Audience ${client.uid} joined channel ${channelName} (latency level ${latencyLevel})`);
        return { client, index: `aud-${index}`, uid: client.uid, channelName };
    } catch (error) {
        log(`Error creating audience ${index}: ${error.message}`);
        throw error;
    }
}

// Create a synthesized audio track so hosts can publish without mic permissions
async function createSynthAudioTrack() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.0001; // near silent
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    oscillator.connect(gainNode);
    const dest = audioContext.createMediaStreamDestination();
    gainNode.connect(dest);
    oscillator.start();
    return AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: dest.stream.getAudioTracks()[0] });
}

// Setup event listeners for a specific client
function setupClientEventListeners(client, index) {
    client.on("user-published", async (user, mediaType) => {
        try {
            await client.subscribe(user, mediaType);
            log(`Client ${index}: Subscribed to remote user ${user.uid} ${mediaType}`);

            if (mediaType === "audio") {
                user.audioTrack.play();
            }
        } catch (error) {
            log(`Client ${index}: Error subscribing to user ${user.uid}: ${error.message}`);
        }
    });
    
    client.on("user-unpublished", (user) => {
        log(`Client ${index}: Remote user ${user.uid} unpublished`);
    });
    
    client.on("connection-state-change", (cur, prev, reason) => {
        log(`Client ${index}: Connection state changed to ${cur} from ${prev} (${reason})`);
    });
    
    client.on("peerconnection-state-change", (curState, revState) => {
        log(`Client ${index}: PeerConnection state changed to ${curState} from ${revState}`);
    });
    
    client.on("exception", (error) => {
        log(`Client ${index}: Exception occurred: ${error.message}`);
    });
}

// For broadcasting test we are audio-only to simplify autoplay and permissions.

// Start the test timer
function startTimer() {
    testState.testTimer = setInterval(() => {
        testState.timeRemaining--;
        document.getElementById('timeRemaining').textContent = testState.timeRemaining;
        
        if (testState.timeRemaining <= 0) {
            log('Test duration completed, stopping test...');
            stopTest();
        }
    }, 1000);
    
    document.getElementById('timer').style.display = 'block';
}

// Stop the test
async function stopTest() {
    if (!testState.isRunning) {
        return;
    }
    
    log('Stopping test...');
    testState.isRunning = false;
    
    // Clear timer
    if (testState.testTimer) {
        clearInterval(testState.testTimer);
        testState.testTimer = null;
    }
    
    document.getElementById('timer').style.display = 'none';
    
    // Leave all channels
    for (let i = 0; i < testState.clients.length; i++) {
        try {
            const clientInfo = testState.clients[i];
            await clientInfo.client.leave();
            log(`Client ${i} left channel ${clientInfo.channelName}`);
        } catch (error) {
            log(`Error leaving client ${i}: ${error.message}`);
        }
    }
    
    // Clean up local tracks
    if (testState.localAudioTrack) {
        testState.localAudioTrack.close();
        testState.localAudioTrack = null;
    }
    if (testState.localVideoTrack) {
        testState.localVideoTrack.close();
        testState.localVideoTrack = null;
    }
    
    // Clear video containers
    const videoContainer = document.getElementById('videoContainer');
    videoContainer.innerHTML = '';
    
    // Clear clients array
    testState.clients = [];
    
    updateUI();
    updateStatus('Test Stopped', 'stopped');
    log('Test stopped successfully');
}

// Update UI state
function updateUI() {
    const startButton = document.getElementById('startTest');
    const stopButton = document.getElementById('stopTest');
    
    if (testState.isRunning) {
        startButton.disabled = true;
        stopButton.disabled = false;
    } else {
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}

// Update status display
function updateStatus(message, className) {
    const statusElement = document.getElementById('testStatus');
    statusElement.textContent = message;
    statusElement.className = `status ${className}`;
}

// Clear log
function clearLog() {
    document.getElementById('log').innerHTML = '';
}

// Logging function
function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logElement = document.getElementById('log');
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${timestamp}] ${message}`;
    logElement.appendChild(logEntry);
    logElement.scrollTop = logElement.scrollHeight;
    console.log(message);
}

// Initialize the testing client when page loads
window.onload = function() {
    initializeTestingClient();
};