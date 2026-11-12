// ----------------- Audio -----------------
let clickSound, hitSound, standSound, gunSound, deathSound;
let finalTwoSound, tensionSound, winnerRevealSound; // 🎯 Final 2 sounds
let immunitySound, rouletteSpinSound, spectatorJoinSound; // 🎯 NEW: Additional game sounds
let roundStartSound, eliminationSound, survivalSound; // 🎯 NEW: Round event sounds

// 🔊 Global mute state
let isMuted = false;

// Load mute state from localStorage
try {
  const savedMuteState = localStorage.getItem('blackjackRouletteMuted');
  if (savedMuteState !== null) {
    isMuted = savedMuteState === 'true';
  }
} catch (e) {
  console.warn('Could not load mute state from localStorage');
}

// Initialize audio with error handling
try {
  clickSound = new Audio('sounds/click.mp3');
  hitSound = new Audio('sounds/hit.mp3');
  standSound = new Audio('sounds/stand.mp3');
  gunSound = new Audio('sounds/gun.mp3');
  deathSound = new Audio('sounds/death.mp3');
  
  // 🎯 NEW: Create synthetic Final 2 sounds since we don't have audio files
  finalTwoSound = createDramaticChord();
  tensionSound = createTensionSound();
  winnerRevealSound = createVictoryFanfare();
  
  // 🎯 NEW: Additional synthetic sounds for enhanced gameplay
  immunitySound = createImmunitySound();
  rouletteSpinSound = createRouletteSpinSound();
  spectatorJoinSound = createSpectatorJoinSound();
  roundStartSound = createRoundStartSound();
  eliminationSound = createEliminationSound();
  survivalSound = createSurvivalSound();
} catch (e) {
  console.warn('Audio files not found, audio will be disabled');
  // Create dummy audio objects
  const dummyAudio = { play: () => {}, pause: () => {}, volume: 1, currentTime: 0 };
  clickSound = dummyAudio;
  hitSound = dummyAudio;
  standSound = dummyAudio;
  gunSound = dummyAudio;
  deathSound = dummyAudio;
  finalTwoSound = dummyAudio;
  tensionSound = dummyAudio;
  winnerRevealSound = dummyAudio;
  immunitySound = dummyAudio;
  rouletteSpinSound = dummyAudio;
  spectatorJoinSound = dummyAudio;
  roundStartSound = dummyAudio;
  eliminationSound = dummyAudio;
  survivalSound = dummyAudio;
}

// 🎯 NEW: Synthetic sound creation for Final 2 effects
function createDramaticChord() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const frequencies = [220, 277, 330]; // A minor chord
        frequencies.forEach((freq, index) => {
          setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.5);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 1.5);
          }, index * 100);
        });
      } catch (e) {
        console.warn('Final Two sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

function createTensionSound() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(80, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(120, audioContext.currentTime + 2);
        oscillator.type = 'triangle';
        
        gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 2);
      } catch (e) {
        console.warn('Tension sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

function createVictoryFanfare() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523, 659, 784, 1047]; // C major chord ascending
        notes.forEach((freq, index) => {
          setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.8);
          }, index * 200);
        });
      } catch (e) {
        console.warn('Victory fanfare failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

// 🎯 NEW: Immunity activation sound (magical shield effect)
function createImmunitySound() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const frequencies = [440, 554, 659]; // A major chord
        frequencies.forEach((freq, index) => {
          setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 1.2);
          }, index * 150);
        });
      } catch (e) {
        console.warn('Immunity sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

// 🎯 NEW: Roulette chamber spinning sound
function createRouletteSpinSound() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 2);
        oscillator.type = 'sawtooth';
        
        gainNode.gain.setValueAtTime(0.03, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 2);
      } catch (e) {
        console.warn('Roulette spin sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

// 🎯 NEW: Spectator join notification sound
function createSpectatorJoinSound() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.3);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
      } catch (e) {
        console.warn('Spectator join sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

// 🎯 NEW: Round start bell sound
function createRoundStartSound() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 1);
      } catch (e) {
        console.warn('Round start sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

// 🎯 NEW: Elimination sound (dramatic low tone)
function createEliminationSound() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(80, audioContext.currentTime + 1.5);
        oscillator.type = 'triangle';
        
        gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 1.5);
      } catch (e) {
        console.warn('Elimination sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

// 🎯 NEW: Survival sound (uplifting chime)
function createSurvivalSound() {
  return {
    play: () => {
      if (!audioUnlocked) return;
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523, 659, 784]; // C major triad
        notes.forEach((freq, index) => {
          setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.06, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.8);
          }, index * 100);
        });
      } catch (e) {
        console.warn('Survival sound failed:', e);
      }
    },
    pause: () => {},
    volume: 1,
    currentTime: 0
  };
}

let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked) return;
  try {
    [clickSound, hitSound, standSound, gunSound, deathSound].forEach(s => {
      try {
        s.volume = s.volume ?? 1;
        s.play?.();
        s.pause?.();
        s.currentTime = 0;
      } catch (e) { /* ignore */ }
    });
  } catch (e) {}
  audioUnlocked = true;
}

function play(sound) {
  if (!sound) return;
  if (isMuted) return; // Don't play if muted
  try {
    if (window._BLACKJACK_SAFE_MODE && (sound === gunSound || sound === deathSound)) return;
    if (!audioUnlocked) {
      try { sound.currentTime = 0; sound.play().catch(()=>{}); } catch (e){}
      return;
    }
    sound.currentTime = 0;
    sound.play().catch(() => {});
  } catch (e) {}
}

// 🔊 Mute/Unmute functions
function toggleMute() {
  isMuted = !isMuted;
  try {
    localStorage.setItem('blackjackRouletteMuted', isMuted.toString());
  } catch (e) {
    console.warn('Could not save mute state to localStorage');
  }
  return isMuted;
}

function setMuted(muted) {
  isMuted = muted;
  try {
    localStorage.setItem('blackjackRouletteMuted', isMuted.toString());
  } catch (e) {
    console.warn('Could not save mute state to localStorage');
  }
  return isMuted;
}

function getMuted() {
  return isMuted;
}

document.addEventListener('pointerdown', unlockAudioOnce, { once: true, passive: true });

export {
  clickSound,
  hitSound,
  standSound,
  gunSound,
  deathSound,
  finalTwoSound,    // 🎯 Final 2 sounds
  tensionSound,     
  winnerRevealSound,
  immunitySound,    // 🎯 NEW: Additional game sounds
  rouletteSpinSound,
  spectatorJoinSound,
  roundStartSound,  // 🎯 NEW: Round event sounds
  eliminationSound,
  survivalSound,
  play,
  unlockAudioOnce,
  toggleMute,       // 🔊 Mute controls
  setMuted,
  getMuted
};
