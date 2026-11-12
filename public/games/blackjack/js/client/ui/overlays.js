// ui/overlays.js
import { setScreen } from './screens.js';
import { play } from './audio.js';


let bloodAnim = null;
let bloodCtx = null;
let bloodParticles = [];
let bloodW = 0;
let bloodH = 0;
let roundSummaryAutoCloseTimer = null;

// 🎯 NEW: Notification system
let notificationQueue = [];
let currentNotification = null;
let notificationTimeout = null;

const deathOverlay = document.getElementById('deathOverlay');
const deathText = document.getElementById('deathText');
const bloodCanvas = document.getElementById('bloodCanvas');

const roundSummaryOverlay = document.getElementById('roundSummaryOverlay');
const roundSummaryBody = document.getElementById('roundSummaryBody');


// ------------------ BLOOD ------------------
function setupBloodCanvas() {
  if (!bloodCanvas) return;

  const dpr = window.devicePixelRatio || 1;
  bloodW = window.innerWidth;
  bloodH = window.innerHeight;

  bloodCanvas.style.width = `${bloodW}px`;
  bloodCanvas.style.height = `${bloodH}px`;
  bloodCanvas.width = bloodW * dpr;
  bloodCanvas.height = bloodH * dpr;

  bloodCtx = bloodCanvas.getContext('2d');
  bloodCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawnBlood() {
  bloodParticles = Array.from({ length: 60 }, () => ({
    x: Math.random() * bloodW,
    y: -20,
    vy: Math.random() * 3 + 2,
    size: Math.random() * 10 + 4
  }));
}

function renderBlood() {
  if (!bloodCtx) return;

  bloodCtx.clearRect(0, 0, bloodW, bloodH);

  bloodParticles.forEach(p => {
    p.y += p.vy;
    bloodCtx.fillStyle = 'rgba(160,0,0,0.85)';
    bloodCtx.beginPath();
    bloodCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    bloodCtx.fill();
  });

  bloodAnim = requestAnimationFrame(renderBlood);
}

function clearBlood() {
  if (bloodAnim) cancelAnimationFrame(bloodAnim);
  bloodAnim = null;
  bloodParticles = [];
  bloodCtx?.clearRect(0, 0, bloodW, bloodH);
}


// ------------------ DEATH ------------------
export function showDeathOverlay(text, deathSound) {
  setScreen('game');
  if (!deathOverlay) return;

  deathText.textContent = text || 'You have been eliminated';
  deathOverlay.classList.remove('hidden');
  deathOverlay.setAttribute('aria-hidden', 'false');

  if (!window._BLACKJACK_SAFE_MODE) {
    setupBloodCanvas();
    spawnBlood();
    renderBlood();
    play(deathSound);
  }

  setTimeout(hideDeathOverlay, 5000);
}

export function hideDeathOverlay() {
  clearBlood();
  deathOverlay?.classList.add('hidden');
  deathOverlay?.setAttribute('aria-hidden', 'true');
}


// ------------------ ROUND SUMMARY ------------------
export function showRoundSummaryOverlay(html) {
  if (!roundSummaryOverlay) return;

  // Clear any previous timer
  if (roundSummaryAutoCloseTimer) {
    clearTimeout(roundSummaryAutoCloseTimer);
    roundSummaryAutoCloseTimer = null;
  }

  roundSummaryBody.innerHTML = html;
  roundSummaryOverlay.classList.remove('hidden');
  roundSummaryOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');


  // ⏱️ AUTO-CLOSE after 5 seconds
  roundSummaryAutoCloseTimer = setTimeout(() => {
    hideRoundSummaryOverlay();
  }, 5000);
}


export function hideRoundSummaryOverlay() {
  if (!roundSummaryOverlay) return;

  if (roundSummaryAutoCloseTimer) {
    clearTimeout(roundSummaryAutoCloseTimer);
    roundSummaryAutoCloseTimer = null;
  }

  if (roundSummaryOverlay.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  roundSummaryOverlay.classList.add('hidden');
  roundSummaryOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

// ------------------ IN-GAME NOTIFICATIONS ------------------

function createNotificationElement() {
  const notification = document.createElement('div');
  notification.className = 'game-notification';
  notification.setAttribute('aria-live', 'polite');
  notification.setAttribute('role', 'alert');
  
  const icon = document.createElement('div');
  icon.className = 'notification-icon';
  
  const content = document.createElement('div');
  content.className = 'notification-content';
  
  const title = document.createElement('div');
  title.className = 'notification-title';
  
  const message = document.createElement('div');
  message.className = 'notification-message';
  
  content.appendChild(title);
  content.appendChild(message);
  notification.appendChild(icon);
  notification.appendChild(content);
  
  return { notification, icon, title, message };
}

function showNotificationElement(notificationData) {
  const { notification, icon, title, message } = createNotificationElement();
  
  // Set content
  icon.textContent = notificationData.icon || '⚠️';
  title.textContent = notificationData.title || 'Notification';
  message.textContent = notificationData.message || '';
  
  // Set type class
  if (notificationData.type) {
    notification.classList.add(`notification-${notificationData.type}`);
  }
  
  // Add to DOM
  document.body.appendChild(notification);
  
  // Animate in
  requestAnimationFrame(() => {
    notification.classList.add('notification-show');
  });
  
  // Store reference
  currentNotification = notification;
  
  // Auto-hide after duration
  const duration = notificationData.duration || 4000;
  notificationTimeout = setTimeout(() => {
    hideCurrentNotification();
  }, duration);
}

function hideCurrentNotification() {
  if (!currentNotification) return;
  
  currentNotification.classList.remove('notification-show');
  currentNotification.classList.add('notification-hide');
  
  setTimeout(() => {
    if (currentNotification && currentNotification.parentNode) {
      currentNotification.parentNode.removeChild(currentNotification);
    }
    currentNotification = null;
    
    // Show next notification if any
    processNotificationQueue();
  }, 300);
  
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }
}

function processNotificationQueue() {
  if (currentNotification || notificationQueue.length === 0) return;
  
  const nextNotification = notificationQueue.shift();
  showNotificationElement(nextNotification);
}

export function showGameNotification(options) {
  const notificationData = {
    title: options.title || 'Notification',
    message: options.message || '',
    icon: options.icon || '⚠️',
    type: options.type || 'info', // info, success, warning, error
    duration: options.duration || 4000
  };
  
  // Add to queue
  notificationQueue.push(notificationData);
  
  // Process queue
  processNotificationQueue();
}

// Convenience functions for common notification types
export function showSuccessNotification(title, message, duration = 3000) {
  showGameNotification({
    title,
    message,
    icon: '✅',
    type: 'success',
    duration
  });
}

export function showErrorNotification(title, message, duration = 5000) {
  showGameNotification({
    title,
    message,
    icon: '❌',
    type: 'error',
    duration
  });
}

export function showWarningNotification(title, message, duration = 4000) {
  showGameNotification({
    title,
    message,
    icon: '⚠️',
    type: 'warning',
    duration
  });
}

export function showInfoNotification(title, message, duration = 3000) {
  showGameNotification({
    title,
    message,
    icon: 'ℹ️',
    type: 'info',
    duration
  });
}



