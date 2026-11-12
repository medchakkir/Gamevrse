// modal.js - Global modal system for ColorRush

// Global modal elements
const globalModal = document.getElementById('globalModal');
const globalModalTitle = document.getElementById('globalModalTitle');
const globalModalMessage = document.getElementById('globalModalMessage');
const globalModalIcon = document.getElementById('globalModalIcon');
const globalModalInput = document.getElementById('globalModalInput');
const globalModalPrimary = document.getElementById('globalModalPrimary');
const globalModalSecondary = document.getElementById('globalModalSecondary');
const globalModalClose = document.getElementById('globalModalClose');

let currentModalResolve = null;
let currentModalReject = null;

// Show a confirmation modal
function showConfirm(title, message, confirmText = 'Confirm', cancelText = 'Cancel', icon = '❓') {
  return new Promise((resolve, reject) => {
    currentModalResolve = resolve;
    currentModalReject = reject;
    
    globalModalTitle.textContent = title;
    globalModalMessage.textContent = message;
    globalModalIcon.textContent = icon;
    globalModalIcon.style.display = 'block';
    globalModalInput.style.display = 'none';
    
    globalModalPrimary.textContent = confirmText;
    globalModalPrimary.className = 'btn-exit'; // Use exit styling for destructive actions
    globalModalPrimary.style.display = 'inline-block';
    
    globalModalSecondary.textContent = cancelText;
    globalModalSecondary.style.display = 'inline-block';
    
    globalModal.style.display = 'flex';
    globalModal.setAttribute('aria-hidden', 'false');
    
    // Focus the cancel button by default for safety
    globalModalSecondary.focus();
  });
}

// Show an alert modal
function showAlert(title, message, buttonText = 'OK', icon = 'ℹ️') {
  return new Promise((resolve) => {
    currentModalResolve = resolve;
    currentModalReject = null;
    
    globalModalTitle.textContent = title;
    globalModalMessage.textContent = message;
    globalModalIcon.textContent = icon;
    globalModalIcon.style.display = 'block';
    globalModalInput.style.display = 'none';
    
    globalModalPrimary.textContent = buttonText;
    globalModalPrimary.className = 'btn-primary';
    globalModalPrimary.style.display = 'inline-block';
    
    globalModalSecondary.style.display = 'none';
    
    globalModal.style.display = 'flex';
    globalModal.setAttribute('aria-hidden', 'false');
    
    globalModalPrimary.focus();
  });
}

// Show an error modal
function showError(title, message, buttonText = 'OK') {
  return showAlert(title, message, buttonText, '❌');
}

// Show a success modal
function showSuccess(title, message, buttonText = 'OK') {
  return showAlert(title, message, buttonText, '✅');
}

// Hide the modal
function hideGlobalModal() {
  globalModal.style.display = 'none';
  globalModal.setAttribute('aria-hidden', 'true');
  
  if (currentModalReject) {
    currentModalReject(new Error('Modal cancelled'));
  }
  
  currentModalResolve = null;
  currentModalReject = null;
}

// Event listeners
if (globalModalPrimary) {
  globalModalPrimary.addEventListener('click', () => {
    if (currentModalResolve) {
      currentModalResolve(true);
    }
    hideGlobalModal();
  });
}

if (globalModalSecondary) {
  globalModalSecondary.addEventListener('click', () => {
    if (currentModalReject) {
      currentModalReject(new Error('Modal cancelled'));
    } else if (currentModalResolve) {
      currentModalResolve(false);
    }
    hideGlobalModal();
  });
}

if (globalModalClose) {
  globalModalClose.addEventListener('click', () => {
    hideGlobalModal();
  });
}

// Close modal on backdrop click
if (globalModal) {
  globalModal.addEventListener('click', (e) => {
    if (e.target === globalModal || e.target.classList.contains('modal-backdrop')) {
      hideGlobalModal();
    }
  });
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && globalModal && globalModal.style.display === 'flex') {
    hideGlobalModal();
  }
});

// Export functions to global scope
window.showConfirm = showConfirm;
window.showAlert = showAlert;
window.showError = showError;
window.showSuccess = showSuccess;
window.hideGlobalModal = hideGlobalModal;