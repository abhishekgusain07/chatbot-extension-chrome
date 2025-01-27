// Authentication state
let isAuthenticated = false;
let authToken = null;

// Check initial auth status
chrome.storage.local.get(['authToken', 'tokenExpiry'], function(result) {
  if (result.authToken && result.tokenExpiry && Date.now() < result.tokenExpiry) {
    isAuthenticated = true;
    authToken = result.authToken;
    initializeChatUI();
  }
});

// Listen for auth status changes
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  
  if (message.type === 'AUTH_STATUS_CHANGED') {
    isAuthenticated = message.isAuthenticated;
    authToken = message.token;
    
    if (isAuthenticated && authToken) {
      console.log('Authentication successful, initializing chat UI');
      initializeChatUI();
    } else {
      console.log('User not authenticated or missing token');
      removeChatUI();
    }
  }
  
  // Handle position updates
  if (message.action === 'updatePosition' && isAuthenticated) {
    updateBubblePosition(message.position);
  }
});

// Initialize chat UI
function initializeChatUI() {
  if (!isAuthenticated) {
    console.log('Not authenticated, skipping UI initialization');
    return;
  }

  console.log('Initializing chat UI');
  
  // Check if UI already exists
  if (document.getElementById('chat-bubble')) {
    console.log('Chat UI already exists');
    return;
  }

  // Create chat UI container
  const container = document.createElement('div');
  container.innerHTML = chatbotHTML;
  document.body.appendChild(container.firstElementChild);

  // Initialize event listeners
  initializeEventListeners();
  console.log('Chat UI initialized');
}

// Remove chat UI
function removeChatUI() {
  const chatBubble = document.getElementById('chat-bubble');
  const chatContainer = document.getElementById('chat-container');
  
  if (chatBubble) {
    chatBubble.remove();
  }
  if (chatContainer) {
    chatContainer.remove();
  }
}

// Initialize event listeners
function initializeEventListeners() {
  const chatBubble = document.getElementById('chat-bubble');
  const chatContainer = document.getElementById('chat-container');
  const closeBtn = document.getElementById('close-btn');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const scrapeBtn = document.getElementById('scrape-btn');

  if (chatBubble) {
    chatBubble.addEventListener('click', () => {
      chatContainer.classList.remove('hidden');
      chatBubble.classList.add('hidden');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      chatContainer.classList.add('hidden');
      chatBubble.classList.remove('hidden');
    });
  }

  if (messageInput && sendBtn) {
    const handleSendMessage = async () => {
      const message = messageInput.value.trim();
      if (message) {
        try {
          const canSendMessage = await checkMessageLimit();
          
          if (!canSendMessage) {
            upgradePopup.classList.remove('hidden');
            return;
          }

          // Show user message
          messageInput.value = '';
          addMessage(message, true);
          
          // Send message to AI and increment count only if successful
          await sendMessageToAI(message);
          await incrementMessageCount();
        } catch (error) {
          console.error('Error:', error);
          addMessage('Sorry, there was an error processing your message. Please try again.', false);
        }
      }
    };

    sendBtn.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSendMessage();
      }
    });
  }

  if (scrapeBtn) {
    scrapeBtn.addEventListener('click', async () => {
      const button = scrapeBtn;
      button.textContent = 'Scraping...';
      button.disabled = true;

      try {
        await handleScraping(true);
        button.textContent = 'Scrape Site';
        button.disabled = false;
        addMessage(`Scraped site successfully! The content is now available for our conversation.`, false);
      } catch (error) {
        console.error('Failed to scrape site:', error);
        button.textContent = 'Scrape Site';
        button.disabled = false;
        addMessage('Sorry, there was an error scraping the site.', false);
      }
    });
  }
}

// API call wrapper with auth token
async function callAPI(endpoint, options = {}) {
  if (!authToken) {
    throw new Error('No auth token available');
  }

  const defaultOptions = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    }
  };

  const finalOptions = { ...defaultOptions, ...options };
  
  try {
    const response = await fetch(endpoint, finalOptions);
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('API call error:', error);
    throw error;
  }
}

// HTML template for the chat UI
const chatbotHTML = `
  <div class="chat-bubble" id="chat-bubble">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="currentColor"/>
    </svg>
  </div>
  <div class="chat-container hidden" id="chat-container">
    <div class="chat-header">
      <div class="header-content">
        <div class="header-title">
          <h2>Chat Assistant</h2>
          <span class="status-indicator">Online</span>
        </div>
        <div class="header-actions">
          <button id="scrape-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 9L12 16L5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Scrape Site
          </button>
          <button id="close-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages">
      <div class="message bot-message">
        Hello! How can I help you today?
      </div>
    </div>
    <div class="chat-input">
      <input type="text" placeholder="Ask me anything..." id="message-input">
      <button id="send-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 2L11 13M22 2L15 22L11 13M11 13L2 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
`;

// Constants for message limits
const FREE_MESSAGE_LIMIT = 5;
const UPGRADE_URL = 'https://your-upgrade-url.com';

// Create upgrade popup HTML
const upgradePopupHTML = `
  <div class="upgrade-popup hidden" id="upgrade-popup">
    <div class="upgrade-content">
      <h3>Message Limit Reached</h3>
      <p>You've reached the free message limit. Upgrade to continue chatting!</p>
      <div class="upgrade-actions">
        <button id="upgrade-btn" class="upgrade-btn">Upgrade Now</button>
        <button id="close-upgrade-btn" class="close-upgrade-btn">Maybe Later</button>
      </div>
    </div>
  </div>
`;

// Create styles
const style = document.createElement('style');
style.textContent = `
  .chat-bubble {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 56px;
    height: 56px;
    border-radius: 28px;
    background: #2563eb;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
    transition: all 0.2s ease;
    z-index: 10000;
  }

  /* Position classes */
  .chat-bubble.top-left { top: 20px; left: 20px; bottom: auto; right: auto; }
  .chat-bubble.top-center { top: 20px; left: 50%; bottom: auto; right: auto; transform: translateX(-50%); }
  .chat-bubble.top-right { top: 20px; right: 20px; bottom: auto; left: auto; }
  .chat-bubble.middle-left { top: 50%; left: 20px; bottom: auto; right: auto; transform: translateY(-50%); }
  .chat-bubble.middle-center { top: 50%; left: 50%; bottom: auto; right: auto; transform: translate(-50%, -50%); }
  .chat-bubble.middle-right { top: 50%; right: 20px; bottom: auto; left: auto; transform: translateY(-50%); }
  .chat-bubble.bottom-left { bottom: 20px; left: 20px; top: auto; right: auto; }
  .chat-bubble.bottom-center { bottom: 20px; left: 50%; top: auto; right: auto; transform: translateX(-50%); }
  .chat-bubble.bottom-right { bottom: 20px; right: 20px; top: auto; left: auto; }

  .chat-bubble:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3);
  }

  /* Maintain hover transform with position transforms */
  .chat-bubble.top-center:hover { transform: translateX(-50%) scale(1.05); }
  .chat-bubble.middle-left:hover { transform: translateY(-50%) scale(1.05); }
  .chat-bubble.middle-center:hover { transform: translate(-50%, -50%) scale(1.05); }
  .chat-bubble.middle-right:hover { transform: translateY(-50%) scale(1.05); }
  .chat-bubble.bottom-center:hover { transform: translateX(-50%) scale(1.05); }

  .chat-container {
    position: fixed;
    bottom: 90px;
    right: 20px;
    width: 380px;
    height: 600px;
    border-radius: 16px;
    background: white;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 10000;
    opacity: 1;
    transform-origin: bottom right;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  }

  .chat-container.hidden {
    opacity: 0;
    transform: scale(0.95);
    pointer-events: none;
  }

  .chat-header {
    background: #2563eb;
    color: white;
    padding: 16px;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-title {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-title h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .status-indicator {
    font-size: 0.8rem;
    opacity: 0.9;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  #scrape-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.2s ease;
  }

  #scrape-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  #scrape-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  #close-btn {
    background: none;
    border: none;
    color: white;
    padding: 4px;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.2s ease;
    display: flex;
    align-items: center;
  }

  #close-btn:hover {
    opacity: 1;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: #f8fafc;
  }

  .message {
    max-width: 85%;
    padding: 12px 16px;
    border-radius: 12px;
    font-size: 0.95rem;
    line-height: 1.5;
    animation: messageAppear 0.3s ease;
  }

  @keyframes messageAppear {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .bot-message {
    background: white;
    border: 1px solid #e2e8f0;
    align-self: flex-start;
    color: #1e293b;
  }

  .user-message {
    background: #2563eb;
    color: white;
    align-self: flex-end;
  }

  .chat-input {
    padding: 16px;
    background: white;
    border-top: 1px solid #e2e8f0;
    max-width: 600px;
    margin: 0 auto;
    position: relative;
  }

  #message-input {
    width: 100%;
    padding: 10px 48px 10px 16px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 0.95rem;
    transition: border-color 0.2s ease;
    outline: none;
    color: #1e293b;
    background: white;
    box-sizing: border-box;
  }

  #message-input::placeholder {
    color: #94a3b8;
  }

  #message-input:focus {
    border-color: #2563eb;
  }

  #send-btn {
    position: absolute;
    right: 24px;
    top: 50%;
    transform: translateY(-50%);
    background: #2563eb;
    color: white;
    border: none;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease;
  }

  #send-btn:hover {
    background: #1d4ed8;
  }

  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: 12px 16px;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    align-self: flex-start;
    width: fit-content;
  }

  .typing-dot {
    width: 6px;
    height: 6px;
    background: #94a3b8;
    border-radius: 50%;
    animation: typingAnimation 1.4s infinite;
  }

  .typing-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .typing-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes typingAnimation {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-4px);
    }
  }
`;

style.textContent += `
  .upgrade-popup {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
    z-index: 10001;
    max-width: 400px;
    width: 90%;
  }

  .upgrade-popup.hidden {
    display: none;
  }

  .upgrade-content {
    text-align: center;
  }

  .upgrade-content h3 {
    margin: 0 0 12px;
    color: #1f2937;
    font-size: 1.5rem;
  }

  .upgrade-content p {
    margin: 0 0 20px;
    color: #4b5563;
  }

  .upgrade-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .upgrade-btn {
    background: #2563eb;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  .upgrade-btn:hover {
    background: #1d4ed8;
  }

  .close-upgrade-btn {
    background: #e5e7eb;
    color: #4b5563;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.2s;
  }

  .close-upgrade-btn:hover {
    background: #d1d5db;
  }
`;

// Create container and inject HTML
const container = document.createElement('div');
container.innerHTML = chatbotHTML;
  
// Create and inject upgrade popup
const upgradePopupDiv = document.createElement('div');
upgradePopupDiv.innerHTML = upgradePopupHTML;
  
// Inject styles and elements
document.head.appendChild(style);
document.body.appendChild(container);
document.body.appendChild(upgradePopupDiv);

// Get DOM elements
const chatBubble = document.getElementById('chat-bubble');
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-btn');
const closeButton = document.getElementById('close-btn');
const scrapeButton = document.getElementById('scrape-btn');
const upgradePopup = document.getElementById('upgrade-popup');
const upgradeBtn = document.getElementById('upgrade-btn');
const closeUpgradeBtn = document.getElementById('close-upgrade-btn');

// Add event listeners for upgrade popup
upgradeBtn.addEventListener('click', () => {
  window.open(UPGRADE_URL, '_blank');
  upgradePopup.classList.add('hidden');
});

closeUpgradeBtn.addEventListener('click', () => {
  upgradePopup.classList.add('hidden');
});

// Function to add message to chat
function addMessage(text, isUser = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
  messageDiv.textContent = text;
  document.getElementById('chat-messages').appendChild(messageDiv);
  document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}

// Function to add typing indicator
function addTypingIndicator() {
  const typingDiv = document.createElement('div');
  typingDiv.className = 'typing-indicator';
  typingDiv.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  `;
  document.getElementById('chat-messages').appendChild(typingDiv);
  document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
  return typingDiv;
}

// Function to check message limit from server
async function checkMessageLimit() {
  try {
    const response = await callAPI('/api/check-limit', {}, 'GET');
    return response.canSendMessage;
  } catch (error) {
    console.error('Error checking message limit:', error);
    return false; // Fail closed - if we can't check the limit, don't allow messages
  }
}

// Function to increment message count on server
async function incrementMessageCount() {
  try {
    await callAPI('/api/increment-count', {}, 'POST');
  } catch (error) {
    console.error('Error incrementing message count:', error);
  }
}

// Event Listeners
sendButton.addEventListener('click', async () => {
  const message = messageInput.value.trim();
  if (message) {
    try {
      const canSendMessage = await checkMessageLimit();
      
      if (!canSendMessage) {
        upgradePopup.classList.remove('hidden');
        return;
      }

      // Show user message
      messageInput.value = '';
      addMessage(message, true);
      
      // Send message to AI and increment count only if successful
      await sendMessageToAI(message);
      await incrementMessageCount();
    } catch (error) {
      console.error('Error:', error);
      addMessage('Sorry, there was an error processing your message. Please try again.', false);
    }
  }
});

// Event listener for chat bubble click
chatBubble.addEventListener('click', () => {
  chatContainer.classList.remove('hidden');
  messageInput.focus();
});

// Event listener for close button click
closeButton.addEventListener('click', () => {
  chatContainer.classList.add('hidden');
});

// Event listener for scrape button click
scrapeButton.addEventListener('click', async () => {
  const button = scrapeButton;
  button.textContent = 'Scraping...';
  button.disabled = true;

  try {
    await handleScraping(true);
    button.textContent = 'Scrape Site';
    button.disabled = false;
    addMessage(`Scraped site successfully! The content is now available for our conversation.`, false);
  } catch (error) {
    console.error('Failed to scrape site:', error);
    button.textContent = 'Scrape Site';
    button.disabled = false;
    addMessage('Sorry, there was an error scraping the site.', false);
  }
});

// Function to load chat history
async function loadChatHistory() {
  try {
    const response = await callAPI('/api/chat-history', {}, 'GET');
    const messages = response.messages;

    // Clear existing messages
    document.getElementById('chat-messages').innerHTML = '';

    // Add each message from history
    messages.forEach(msg => {
      addMessage(msg.content, msg.role === 'user');
    });

    // Scroll to bottom
    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

// Load chat history
loadChatHistory();
