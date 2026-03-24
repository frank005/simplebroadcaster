// Web SDK Testing Client
AgoraRTC.setParameter("SHOW_GLOBAL_CLIENT_LIST", true);
AgoraRTC.setLogLevel(4);


//overide the RTCPeerConnection to count the number of PeerConnections created
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
    hostCycleAbort: null,
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
    hostPublishDuration: 0, // seconds; 0 = hosts stay entire test (no cycling)
    hostRejoinInterval: 0, // seconds; gap between leave and rejoin
    hostStaggerOffset: 0, // seconds; each host delays start by index * offset
    hostRandomTiming: false, // if true, randomize publish/rejoin each cycle
    hostPublishMax: 0, // max publish duration (min = hostPublishDuration)
    hostRejoinMax: 0, // max rejoin interval (min = hostRejoinInterval)
    geoRegions: [], // array of area codes to round-robin for audiences
    useStringUid: false, // if true, use string UID "string" instead of null (auto-assigned integers)
    publishAudio: true, // if true, publish synthetic audio track
    publishCamera: false // if true, publish camera video track
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
    const hostPubDurEl = document.getElementById('hostPublishDuration');
    if (hostPubDurEl) hostPubDurEl.onchange = updateConfig;
    const hostRejoinEl = document.getElementById('hostRejoinInterval');
    if (hostRejoinEl) hostRejoinEl.onchange = updateConfig;
    const hostStaggerEl = document.getElementById('hostStaggerOffset');
    if (hostStaggerEl) hostStaggerEl.onchange = updateConfig;
    const hostRandomEl = document.getElementById('hostRandomTiming');
    if (hostRandomEl) hostRandomEl.onchange = handleHostRandomToggle;
    ['hostPublishMax', 'hostRejoinMax'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onchange = updateConfig;
    });
    const geoRegionsEl = document.getElementById('geoRegions');
    if (geoRegionsEl) geoRegionsEl.onchange = updateConfig;
    const useStringUidEl = document.getElementById('useStringUid');
    if (useStringUidEl) useStringUidEl.onchange = updateConfig;
    const publishAudioEl = document.getElementById('publishAudio');
    if (publishAudioEl) publishAudioEl.onchange = updateConfig;
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
    const hostPubDurVal = document.getElementById('hostPublishDuration')?.value;
    const parsedPubDur = hostPubDurVal === '' || hostPubDurVal == null ? 0 : parseFloat(hostPubDurVal);
    testConfig.hostPublishDuration = isNaN(parsedPubDur) ? 0 : Math.max(0, parsedPubDur);
    const hostRejoinVal = document.getElementById('hostRejoinInterval')?.value;
    const parsedRejoin = hostRejoinVal === '' || hostRejoinVal == null ? 0 : parseFloat(hostRejoinVal);
    testConfig.hostRejoinInterval = isNaN(parsedRejoin) ? 0 : Math.max(0, parsedRejoin);
    const staggerVal = document.getElementById('hostStaggerOffset')?.value;
    const parsedStagger = staggerVal === '' || staggerVal == null ? 0 : parseFloat(staggerVal);
    testConfig.hostStaggerOffset = isNaN(parsedStagger) ? 0 : Math.max(0, parsedStagger);
    const randomEl = document.getElementById('hostRandomTiming');
    testConfig.hostRandomTiming = randomEl ? randomEl.checked : false;
    function parseNumField(id) {
        const v = document.getElementById(id)?.value;
        const n = v === '' || v == null ? 0 : parseFloat(v);
        return isNaN(n) ? 0 : Math.max(0, n);
    }
    testConfig.hostPublishMax = parseNumField('hostPublishMax');
    testConfig.hostRejoinMax = parseNumField('hostRejoinMax');
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
    const publishAudioEl = document.getElementById('publishAudio');
    if (publishAudioEl) {
        testConfig.publishAudio = publishAudioEl.checked;
    }
    const publishCameraEl = document.getElementById('publishCamera');
    if (publishCameraEl) {
        testConfig.publishCamera = publishCameraEl.checked;
    }
}

// Toggle random timing fields visibility
function handleHostRandomToggle() {
    const checked = document.getElementById('hostRandomTiming')?.checked;
    const fields = document.getElementById('hostRandomFields');
    if (fields) {
        fields.style.display = checked ? 'block' : 'none';
    }
    updateConfig();
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
        const totalRequested = (testConfig.hostsCount || 0) + (testConfig.audiencesCount || 0);
        if (totalRequested <= 0) {
            throw new Error('Please configure at least 1 client (host or audience)');
        }

        testState.hostCycleAbort = new AbortController();

        await createAndJoinClientsLive();
        
        if (testConfig.publishCamera) {
            createAudienceTable();
            triggerInitialVisibilityCheck();
        }
        
        startTimer();
        
        const total = (testConfig.hostsCount || 0) + (testConfig.audiencesCount || 0);
        const hostCyclingEnabled = testConfig.hostPublishDuration > 0 || testConfig.hostRandomTiming;
        const cycling = hostCyclingEnabled ? ' (hosts cycling)' : '';
        log(`Test started with ${total} clients (hosts: ${testConfig.hostsCount}, audiences: ${testConfig.audiencesCount})${cycling}`);
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
    const hostCycling = testConfig.hostPublishDuration > 0 || testConfig.hostRandomTiming;
    for (let i = 0; i < (testConfig.hostsCount || 0); i++) {
        const clientInfo = await createHostClient(i, channel);
        testState.clients.push(clientInfo);
        if (hostCycling) {
            const staggerMs = (testConfig.hostStaggerOffset || 0) * 1000 * i;
            const mode = testConfig.hostRandomTiming ? 'random' : 'fixed';
            log(`Host ${i}: starting cycle loop (${mode}, stagger ${staggerMs}ms)`);
            runHostCycleLoop(clientInfo, i, channel, testState.hostCycleAbort.signal, staggerMs)
                .catch(e => log(`Host ${i}: cycle loop unhandled error: ${e.message}`));
        }
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
        
        if (testConfig.publishAudio) {
            const audioTrack = await createSynthAudioTrack();
            tracksToPublish.push(audioTrack);
        }
        if (testConfig.publishCamera) {
            const videoTrack = await AgoraRTC.createCameraVideoTrack();
            tracksToPublish.push(videoTrack);
        }

        if (tracksToPublish.length > 0) {
            await client.publish(tracksToPublish);
        }
        const mediaTypes = [
            testConfig.publishAudio ? 'audio' : null,
            testConfig.publishCamera ? 'video' : null
        ].filter(Boolean).join('+') || 'none';
        log(`Host ${client.uid} joined channel ${channelName} and published ${mediaTypes}`);
        
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
    gainNode.gain.value = 0.3;
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    oscillator.connect(gainNode);
    const dest = audioContext.createMediaStreamDestination();
    gainNode.connect(dest);
    oscillator.start();
    return AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: dest.stream.getAudioTracks()[0] });
}

// Cancellable sleep that rejects when the signal is aborted
function cancellableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

function getRandomInRange(min, max) {
    return min + Math.random() * (max - min);
}

function getCyclePublishMs() {
    const minS = testConfig.hostPublishDuration || 0;
    if (testConfig.hostRandomTiming && testConfig.hostPublishMax > minS) {
        return getRandomInRange(minS, testConfig.hostPublishMax) * 1000;
    }
    return minS * 1000;
}

function getCycleRejoinMs() {
    const minS = testConfig.hostRejoinInterval || 0;
    if (testConfig.hostRandomTiming && testConfig.hostRejoinMax > minS) {
        return getRandomInRange(minS, testConfig.hostRejoinMax) * 1000;
    }
    return minS * 1000;
}

// Host cycling loop: join -> publish -> wait publishDuration -> leave -> wait rejoinInterval -> repeat
async function runHostCycleLoop(clientInfo, hostIndex, channelName, signal, staggerMs) {
    let cycleCount = 0;

    try {
        // Stagger: delay this host's first cycle
        if (staggerMs > 0) {
            log(`Host ${hostIndex}: stagger waiting ${staggerMs}ms before first cycle...`);
            await cancellableSleep(staggerMs, signal);
        }

        // First cycle: already joined, just wait for the publish duration then leave
        const firstPublishMs = getCyclePublishMs();
        log(`Host ${hostIndex}: publishing for ${(firstPublishMs / 1000).toFixed(1)}s...`);
        await cancellableSleep(firstPublishMs, signal);

        while (!signal.aborted) {
            // Leave
            try {
                if (clientInfo.localTracks) {
                    for (const track of clientInfo.localTracks) {
                        track.close();
                    }
                    clientInfo.localTracks = [];
                }
                await clientInfo.client.leave();
                cycleCount++;
                log(`Host ${hostIndex}: left channel (cycle ${cycleCount})`);
            } catch (e) {
                if (signal.aborted) break;
                log(`Host ${hostIndex}: error leaving: ${e.message}`);
            }

            // Wait before rejoining
            const rejoinMs = getCycleRejoinMs();
            if (rejoinMs > 0) {
                log(`Host ${hostIndex}: waiting ${(rejoinMs / 1000).toFixed(1)}s before rejoin...`);
                await cancellableSleep(rejoinMs, signal);
            }

            if (signal.aborted) break;

            // Rejoin and publish
            try {
                const uid = testConfig.useStringUid ? `string-${hostIndex}` : null;
                await clientInfo.client.join(testConfig.appId, channelName, null, uid);
                await clientInfo.client.setClientRole('host');
                const tracks = [];
                if (testConfig.publishAudio) {
                    tracks.push(await createSynthAudioTrack());
                }
                if (testConfig.publishCamera) {
                    tracks.push(await AgoraRTC.createCameraVideoTrack());
                }
                if (tracks.length > 0) {
                    await clientInfo.client.publish(tracks);
                }
                clientInfo.localTracks = tracks;
                clientInfo.uid = clientInfo.client.uid;
                log(`Host ${clientInfo.client.uid}: rejoined and published (cycle ${cycleCount + 1})`);
            } catch (e) {
                if (signal.aborted) break;
                log(`Host ${hostIndex}: error rejoining: ${e.message}`);
                break;
            }

            // Stay connected for publishDuration
            const publishMs = getCyclePublishMs();
            log(`Host ${hostIndex}: publishing for ${(publishMs / 1000).toFixed(1)}s...`);
            await cancellableSleep(publishMs, signal);
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            log(`Host ${hostIndex}: cycle loop aborted (test stopped)`);
        } else {
            log(`Host ${hostIndex}: cycle loop error: ${e.message}`);
        }
    }
    log(`Host ${hostIndex}: cycle loop finished (${cycleCount} complete cycles)`);
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

    // Abort host cycling loops
    if (testState.hostCycleAbort) {
        testState.hostCycleAbort.abort();
        testState.hostCycleAbort = null;
    }
    
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
            if (clientInfo.localTracks && Array.isArray(clientInfo.localTracks)) {
                for (const track of clientInfo.localTracks) {
                    try {
                        track.close();
                    } catch (trackError) {
                        log(`Client ${clientInfo.index}: Error closing track: ${trackError.message}`);
                    }
                }
            }
            await clientInfo.client.leave();
            log(`Client ${clientInfo.index} left channel ${clientInfo.channelName}`);
            await clientInfo.client.removeAllListeners();
        } catch (error) {
            log(`Error leaving client ${clientInfo.index}: ${error.message}`);
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