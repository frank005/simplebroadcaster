// Web SDK Testing Client
AgoraRTC.setParameter("SHOW_GLOBAL_CLIENT_LIST", true);

let pcCounter = 0;

(function () {
    const Orig = window.RTCPeerConnection;
  
    window.RTCPeerConnection = function (...args) {
      const pc = new Orig(...args);
  
      // Fire your custom hook
      window.dispatchEvent(new CustomEvent("peer-connection-created", {
        detail: { pc, args }
      }));
  
      return pc;
    };
  
    window.RTCPeerConnection.prototype = Orig.prototype;
    window.RTCPeerConnection.prototype.constructor = window.RTCPeerConnection;
  })();

  window.addEventListener("peer-connection-created", (ev) => {
    pcCounter++;
    console.log("PC created:", pcCounter);
    log(`PC created: ${pcCounter}`);
    updatePCCounterDisplay();
  });

// Global state management
let testState = {
    isRunning: false,
    clients: [],
    testTimer: null,
    timeRemaining: 0,
    intersectionObserver: null,
    audienceCells: []
};

// Test configuration
let testConfig = {
    appId: '',
    hostsCount: 1,
    audiencesCount: 5,
    channelName: 'simplebroadcast',
    audienceType: 'interactive', // interactive|broadcast
    testDuration: 60,
    audienceJoinInterval: 0, // seconds; 0 or empty = immediate joins (current behavior)
    geoRegions: [], // array of area codes to round-robin for audiences
    useStringUid: false, // if true, use string UID "string" instead of null (auto-assigned integers)
    publishCamera: false // if true, publish camera instead of fake audio track
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
    const geoRegionsEl = document.getElementById('geoRegions');
    if (geoRegionsEl) geoRegionsEl.onchange = updateConfig;
    const useStringUidEl = document.getElementById('useStringUid');
    if (useStringUidEl) useStringUidEl.onchange = updateConfig;
    const publishCameraEl = document.getElementById('publishCamera');
    if (publishCameraEl) publishCameraEl.onchange = handlePublishCameraChange;
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
    const geoRegionsSelect = document.getElementById('geoRegions');
    if (geoRegionsSelect) {
        const selected = Array.from(geoRegionsSelect.selectedOptions).map(o => o.value);
        // Filter out empty selections
        testConfig.geoRegions = selected.filter(Boolean);
    }
    const useStringUidEl = document.getElementById('useStringUid');
    if (useStringUidEl) {
        testConfig.useStringUid = useStringUidEl.checked;
    }
    const publishCameraEl = document.getElementById('publishCamera');
    if (publishCameraEl) {
        testConfig.publishCamera = publishCameraEl.checked;
    }
}

// Handle publish camera checkbox change
function handlePublishCameraChange() {
    const publishCameraEl = document.getElementById('publishCamera');
    const hostsCountEl = document.getElementById('hostsCount');
    
    if (publishCameraEl.checked) {
        // Set hosts to 1 and disable the input
        hostsCountEl.value = 1;
        hostsCountEl.disabled = true;
    } else {
        // Re-enable the input
        hostsCountEl.disabled = false;
    }
    
    // Update config
    updateConfig();
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
        
        // Create the audience table UI only if publishing camera (after clients are created)
        if (testConfig.publishCamera) {
            createAudienceTable();
            // Trigger initial visibility check for cells that are already visible
            triggerInitialVisibilityCheck();
        }
        
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
    let audienceRegionIndex = 0;

    // Create hosts
    for (let i = 0; i < (testConfig.hostsCount || 0); i++) {
        const clientInfo = await createHostClient(i, channel);
        testState.clients.push(clientInfo);
    }

    // Create audiences
    for (let i = 0; i < (testConfig.audiencesCount || 0); i++) {
        // Set geofence region for this audience if configured
        const regions = Array.isArray(testConfig.geoRegions) ? testConfig.geoRegions : [];
        if (regions.length > 0) {
            const region = regions[audienceRegionIndex % regions.length];
            try {
                if (region && region !== 'GLOBAL') {
                    AgoraRTC.setArea({ areaCode: region });
                    log(`Audience ${i}: Set geofence region to ${region}`);
                } else {
                    // Reset to global/default
                    AgoraRTC.setArea({ areaCode: 'GLOBAL' });
                    log(`Audience ${i}: Set geofence region to GLOBAL`);
                }
            } catch (e) {
                log(`Audience ${i}: Failed to set region (${region}): ${e.message}`);
            }
            audienceRegionIndex++;
        }

        const clientInfo = await createAudienceClient(i, channel, latencyLevel);
        testState.clients.push(clientInfo);
        if (audienceIntervalMs > 0 && i < (testConfig.audiencesCount - 1)) {
            await sleep(audienceIntervalMs);
        }
    }

    // After creating audiences, reset geofence to GLOBAL so future operations aren't pinned
    try {
        AgoraRTC.setArea({ areaCode: 'GLOBAL' });
        log('Geofence reset to GLOBAL after audience creation');
    } catch (e) {
        log(`Failed to reset geofence to GLOBAL: ${e.message}`);
    }

    log(`Created ${testState.clients.length} clients`);
}

// Create a host client in live mode and publish a track (camera or fake audio)
async function createHostClient(index, channelName) {
    const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
    setupClientEventListeners(client, `host-${index}`);
    try {
        // Use string UID "string" with index suffix if enabled, otherwise null (auto-assigned integer)
        // Each client needs a unique UID, so we append the index
        const uid = testConfig.useStringUid ? `string-${index}` : null;
        await client.join(testConfig.appId, channelName, null, uid);
        await client.setClientRole('host');
        
        let tracksToPublish = [];
        
        if (testConfig.publishCamera) {
            // Create and publish camera video track
            const videoTrack = await AgoraRTC.createCameraVideoTrack();
            tracksToPublish.push(videoTrack);
            log(`Host ${client.uid} created camera video track`);
        } else {
            // Create and publish fake audio track
            const audioTrack = await createSynthAudioTrack();
            tracksToPublish.push(audioTrack);
            log(`Host ${client.uid} created fake audio track`);
        }
        
        await client.publish(tracksToPublish);
        const mediaType = testConfig.publishCamera ? 'video' : 'audio';
        log(`Host ${client.uid} joined channel ${channelName} and published ${mediaType}`);
        
        return { 
            client, 
            index: `host-${index}`, 
            uid: client.uid, 
            channelName, 
            localTracks: tracksToPublish 
        };
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
        const hostsCount = testConfig.hostsCount || 0;
        const uid = testConfig.useStringUid ? `string-${hostsCount + index}` : null;
        
        const clientInfo = {
            client,
            index: `aud-${index}`,
            audienceIndex: index,
            uid: null, // Will be set after join
            channelName,
            latencyLevel,
            joinState: 'disconnected', // 'disconnected' | 'joining' | 'joined' | 'leaving'
            subscribeState: 'unsubscribed', // 'unsubscribed' | 'subscribing' | 'subscribed'
            desiredUid: uid
        };
        
        // If publishCamera is NOT checked, join immediately (audio-only mode)
        if (!testConfig.publishCamera) {
            await client.join(testConfig.appId, channelName, null, uid);
            await client.setClientRole('audience', { level: latencyLevel });
            clientInfo.uid = client.uid;
            clientInfo.joinState = 'joined';
            log(`Audience ${client.uid} joined channel ${channelName} (latency level ${latencyLevel})`);
        } else {
            // If publishCamera is checked, don't join yet - visibility will control it
            log(`Audience ${index} created but not joined (visibility-controlled)`);
        }
        
        return clientInfo;
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
            // Find the client info to check visibility state
            const clientInfo = testState.clients.find(c => c.client === client);
            
            // If this is an audience client in visibility-controlled mode (publishCamera enabled)
            // only subscribe to video if fully visible
            if (clientInfo && clientInfo.audienceIndex !== undefined && testConfig.publishCamera && mediaType === 'video') {
                // Check the corresponding cell's visibility
                const cell = testState.audienceCells[clientInfo.audienceIndex];
                if (cell && cell.classList.contains('visible-full')) {
                    await client.subscribe(user, mediaType);
                    clientInfo.subscribeState = 'subscribed';
                    log(`Client ${index}: Subscribed to remote user ${user.uid} ${mediaType} (fully visible)`);
                    
                    // Play the video track into the audience cell
                    if (user.videoTrack) {
                        user.videoTrack.play(cell);
                        log(`Client ${index}: Playing video in audience cell ${clientInfo.audienceIndex}`);
                    }
                } else {
                    log(`Client ${index}: Skipping subscription to ${mediaType} (not fully visible)`);
                    return;
                }
            } else {
                // For hosts or audio-only mode, subscribe normally
                await client.subscribe(user, mediaType);
                if (clientInfo) {
                    clientInfo.subscribeState = 'subscribed';
                }
                log(`Client ${index}: Subscribed to remote user ${user.uid} ${mediaType}`);
                
                // Handle playback for non-visibility-controlled clients
                if (mediaType === "audio") {
                    user.audioTrack.play();
                }
            }
        } catch (error) {
            log(`Client ${index}: Error subscribing to user ${user.uid}: ${error.message}`);
        }
    });
    
    client.on("user-unpublished", (user, mediaType) => {
        log(`Client ${index}: Remote user ${user.uid} unpublished ${mediaType || 'track'}`);
        const clientInfo = testState.clients.find(c => c.client === client);
        if (clientInfo && mediaType === 'video') {
            clientInfo.subscribeState = 'unsubscribed';
        }
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

// Create the audience table with visibility-based color coding
function createAudienceTable() {
    const videoContainer = document.getElementById('videoContainer');
    videoContainer.innerHTML = '';
    testState.audienceCells = [];
    
    const audienceCount = testConfig.audiencesCount || 0;
    if (audienceCount === 0) {
        return; // No audience clients to display
    }
    
    // Create table container
    const table = document.createElement('div');
    table.className = 'audience-table';
    
    // Create cells for each audience client
    for (let i = 0; i < audienceCount; i++) {
        const cell = document.createElement('div');
        cell.className = 'audience-cell visible-none';
        cell.textContent = `Audience ${i}`;
        cell.dataset.index = i;
        table.appendChild(cell);
        testState.audienceCells.push(cell);
    }
    
    videoContainer.appendChild(table);
    
    // Setup Intersection Observer to track visibility
    setupVisibilityObserver();
    
    log(`Created audience table with ${audienceCount} cells (${Math.ceil(audienceCount / 2)} rows)`);
}

// Setup Intersection Observer to detect when cells are visible
function setupVisibilityObserver() {
    // Clean up existing observer if any
    if (testState.intersectionObserver) {
        testState.intersectionObserver.disconnect();
    }
    
    const options = {
        root: document.getElementById('videoContainer'),
        rootMargin: '0px',
        threshold: [0, 0.1, 0.5, 0.9, 1.0] // Multiple thresholds for granular detection
    };
    
    testState.intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const cell = entry.target;
            const audienceIndex = parseInt(cell.dataset.index);
            
            // Remove all visibility classes
            cell.classList.remove('visible-full', 'visible-partial', 'visible-none');
            
            // Determine visibility state and update client accordingly
            if (entry.intersectionRatio >= 1.0) {
                // Fully visible - should be joined AND subscribed
                cell.classList.add('visible-full');
                handleAudienceVisibilityChange(audienceIndex, 'full');
            } else if (entry.intersectionRatio > 0) {
                // Partially visible - should be joined but not subscribed
                cell.classList.add('visible-partial');
                handleAudienceVisibilityChange(audienceIndex, 'partial');
            } else {
                // Not visible - should be disconnected
                cell.classList.add('visible-none');
                handleAudienceVisibilityChange(audienceIndex, 'none');
            }
        });
    }, options);
    
    // Observe all audience cells
    testState.audienceCells.forEach(cell => {
        testState.intersectionObserver.observe(cell);
    });
}

// Trigger initial visibility check for all cells
function triggerInitialVisibilityCheck() {
    // Give the DOM a moment to settle, then manually check visibility for all cells
    setTimeout(() => {
        const container = document.getElementById('videoContainer');
        if (!container) return;
        
        testState.audienceCells.forEach((cell, index) => {
            const rect = cell.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // Calculate intersection ratio manually
            const cellTop = rect.top;
            const cellBottom = rect.bottom;
            const containerTop = containerRect.top;
            const containerBottom = containerRect.bottom;
            
            if (cellBottom <= containerTop || cellTop >= containerBottom) {
                // Not visible
                cell.classList.remove('visible-full', 'visible-partial');
                cell.classList.add('visible-none');
            } else if (cellTop >= containerTop && cellBottom <= containerBottom) {
                // Fully visible
                cell.classList.remove('visible-partial', 'visible-none');
                cell.classList.add('visible-full');
                handleAudienceVisibilityChange(index, 'full');
            } else {
                // Partially visible
                cell.classList.remove('visible-full', 'visible-none');
                cell.classList.add('visible-partial');
                handleAudienceVisibilityChange(index, 'partial');
            }
        });
        
        log('Initial visibility check completed');
    }, 100);
}

// Handle audience client state changes based on visibility
async function handleAudienceVisibilityChange(audienceIndex, visibility) {
    // Find the client info for this audience
    const clientInfo = testState.clients.find(c => c.audienceIndex === audienceIndex);
    if (!clientInfo) {
        return; // Client not found
    }
    
    try {
        if (visibility === 'full') {
            // Fully visible - ensure joined and subscribed
            await ensureAudienceJoined(clientInfo);
            await ensureAudienceSubscribed(clientInfo);
        } else if (visibility === 'partial') {
            // Partially visible - ensure joined but unsubscribe
            await ensureAudienceJoined(clientInfo);
            await ensureAudienceUnsubscribed(clientInfo);
        } else {
            // Not visible - ensure left the channel
            await ensureAudienceLeft(clientInfo);
        }
    } catch (error) {
        log(`Error handling visibility change for audience ${audienceIndex}: ${error.message}`);
    }
}

// Ensure an audience client has joined the channel
async function ensureAudienceJoined(clientInfo) {
    if (clientInfo.joinState === 'joined' || clientInfo.joinState === 'joining') {
        return; // Already joined or joining
    }
    
    try {
        clientInfo.joinState = 'joining';
        await clientInfo.client.join(
            testConfig.appId,
            clientInfo.channelName,
            null,
            clientInfo.desiredUid,
            { autoSubscribe: true }
        );
        await clientInfo.client.setClientRole('audience', { level: clientInfo.latencyLevel });
        clientInfo.uid = clientInfo.client.uid;
        clientInfo.joinState = 'joined';
        log(`Audience ${clientInfo.audienceIndex} (UID: ${clientInfo.uid}) joined channel`);
    } catch (error) {
        clientInfo.joinState = 'disconnected';
        log(`Error joining audience ${clientInfo.audienceIndex}: ${error.message}`);
        throw error;
    }
}

// Ensure an audience client has left the channel
async function ensureAudienceLeft(clientInfo) {
    if (clientInfo.joinState === 'disconnected' || clientInfo.joinState === 'leaving') {
        return; // Already disconnected or leaving
    }
    
    try {
        clientInfo.joinState = 'leaving';
        await clientInfo.client.leave();
        clientInfo.joinState = 'disconnected';
        clientInfo.subscribeState = 'unsubscribed';
        log(`Audience ${clientInfo.audienceIndex} left channel`);
    } catch (error) {
        clientInfo.joinState = 'disconnected';
        log(`Error leaving audience ${clientInfo.audienceIndex}: ${error.message}`);
        throw error;
    }
}

// Ensure an audience client is subscribed to remote video tracks
async function ensureAudienceSubscribed(clientInfo) {
    if (clientInfo.subscribeState === 'subscribed') {
        return; // Already subscribed
    }
    
    try {
        // Get all remote users
        const remoteUsers = clientInfo.client.remoteUsers;
        for (const user of remoteUsers) {
            if (user.hasVideo) {
                // Subscribe if not already subscribed
                if (!user.videoTrack) {
                    await clientInfo.client.subscribe(user, 'video');
                }
                
                // Play the video track into the audience cell
                const cell = testState.audienceCells[clientInfo.audienceIndex];
                if (cell && user.videoTrack) {
                    user.videoTrack.play(cell);
                    log(`Audience ${clientInfo.audienceIndex} subscribed and playing video from user ${user.uid}`);
                }
            }
        }
        clientInfo.subscribeState = 'subscribed';
    } catch (error) {
        log(`Error subscribing audience ${clientInfo.audienceIndex}: ${error.message}`);
    }
}

// Ensure an audience client is unsubscribed from remote tracks
async function ensureAudienceUnsubscribed(clientInfo) {
    if (clientInfo.subscribeState === 'unsubscribed') {
        return; // Already unsubscribed
    }
    
    try {
        // Get all remote users
        const remoteUsers = clientInfo.client.remoteUsers;
        for (const user of remoteUsers) {
            if (user.hasVideo && user.videoTrack) {
                // Stop playing the video in the cell
                user.videoTrack.stop();
                await clientInfo.client.unsubscribe(user, 'video');
                log(`Audience ${clientInfo.audienceIndex} unsubscribed from user ${user.uid} video`);
            }
        }
        
        // Clear the cell content to remove the video element
        const cell = testState.audienceCells[clientInfo.audienceIndex];
        if (cell) {
            // Keep the text label but remove any video elements
            cell.textContent = `Audience ${clientInfo.audienceIndex}`;
        }
        
        clientInfo.subscribeState = 'unsubscribed';
    } catch (error) {
        log(`Error unsubscribing audience ${clientInfo.audienceIndex}: ${error.message}`);
    }
}

// Update PC counter display
function updatePCCounterDisplay() {
    const pcCountElement = document.getElementById('pcCount');
    if (pcCountElement) {
        pcCountElement.textContent = pcCounter;
    }
}

// Start the test timer
function startTimer() {
    const timerElement = document.getElementById('timer');
    const timeRemainingElement = document.getElementById('timeRemaining');
    const pcCounterElement = document.getElementById('pcCounter');
    
    if (!timerElement || !timeRemainingElement) {
        log('Warning: Timer elements not found in DOM');
        return;
    }
    
    // Initialize the display with the current time remaining
    timeRemainingElement.textContent = testState.timeRemaining;
    // Make sure timer is visible
    timerElement.style.display = 'block';
    timerElement.style.visibility = 'visible';
    timerElement.style.opacity = '1';
    timerElement.removeAttribute('hidden');
    
    // Show and initialize PC counter
    if (pcCounterElement) {
        pcCounterElement.style.display = 'block';
        pcCounterElement.style.visibility = 'visible';
        pcCounterElement.style.opacity = '1';
        pcCounterElement.removeAttribute('hidden');
        updatePCCounterDisplay();
    }
    
    log(`Timer started: ${testState.timeRemaining} seconds remaining`);
    
    testState.testTimer = setInterval(() => {
        testState.timeRemaining--;
        timeRemainingElement.textContent = testState.timeRemaining;
        
        if (testState.timeRemaining <= 0) {
            log('Test duration completed, stopping test...');
            stopTest();
        }
    }, 1000);
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
    
    const timerElement = document.getElementById('timer');
    if (timerElement) {
        timerElement.style.display = 'none';
    }
    
    // Hide PC counter
    const pcCounterElement = document.getElementById('pcCounter');
    if (pcCounterElement) {
        pcCounterElement.style.display = 'none';
    }
    
    // Leave all channels and clean up tracks
    for (let i = 0; i < testState.clients.length; i++) {
        try {
            const clientInfo = testState.clients[i];
            
            // Close local tracks if they exist
            if (clientInfo.localTracks && Array.isArray(clientInfo.localTracks)) {
                for (const track of clientInfo.localTracks) {
                    try {
                        track.close();
                        log(`Client ${i}: Closed local track`);
                    } catch (trackError) {
                        log(`Client ${i}: Error closing track: ${trackError.message}`);
                    }
                }
            }
            
            await clientInfo.client.leave();
            log(`Client ${i} left channel ${clientInfo.channelName}`);
            await clientInfo.client.removeAllListeners();
            log(`Client ${i} removed all listeners`);
        } catch (error) {
            log(`Error leaving client ${i}: ${error.message}`);
        }
    }
    
    // Clean up Intersection Observer
    if (testState.intersectionObserver) {
        testState.intersectionObserver.disconnect();
        testState.intersectionObserver = null;
    }
    
    // Clear video containers
    const videoContainer = document.getElementById('videoContainer');
    videoContainer.innerHTML = '';
    
    // Clear audience cells array
    testState.audienceCells = [];
    
    // Clear clients array
    testState.clients = [];

    //reset PeerConnection counter
    pcCounter = 0;
    
    updateUI();
    updateStatus('Test Stopped', 'stopped');
    log('Test stopped successfully');

    // Ensure geofence is reset to global after test stops
    try {
        AgoraRTC.setArea({ areaCode: 'GLOBAL' });
        log('Geofence reset to GLOBAL');
    } catch (e) {
        log(`Failed to reset geofence to GLOBAL: ${e.message}`);
    }
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