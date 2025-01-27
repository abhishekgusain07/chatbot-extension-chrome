// Initialize variables
const CLERK_DOMAIN = 'proud-porpoise-50.clerk.accounts.dev';
const CLIENT_ID = 'Gz43F2t7JlnvKFZL';
const CLIENT_SECRET = 'UmJ0MfWB7NTHKtig8A9ggwyx6yXd8OiZ'
const TOKEN_ENDPOINT = 'https://proud-porpoise-50.clerk.accounts.dev/oauth/token';

// Log the callback URL for configuration
console.log('Extension callback URL:', chrome.identity.getRedirectURL());

let isAuthenticated = false;
let currentUser = null;

// DOM Elements
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const signOutBtn = document.getElementById('sign-out-btn');

// Authentication state management
// Function to update UI based on auth state
function updateUIForAuthState() {
  if (isAuthenticated && currentUser) {
    authContainer.classList.add('hidden');
    appContainer.classList.add('visible');
    // Store user token in extension storage
    chrome.storage.local.set({
      authToken: currentUser.session.token,
      userId: currentUser.id
    });
    // Notify content script about authentication
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'AUTH_STATE_CHANGED',
        isAuthenticated: true,
        userId: currentUser.id
      });
    });
  } else {
    authContainer.classList.remove('hidden');
    appContainer.classList.remove('visible');
    // Clear auth data from storage
    chrome.storage.local.remove(['authToken', 'userId']);
    // Notify content script about authentication
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'AUTH_STATE_CHANGED',
        isAuthenticated: false
      });
    });
  }
}

// Handle authentication
async function initializeAuth() {
  const token = await chrome.storage.local.get('authToken');
  if (token.authToken) {
    isAuthenticated = true;
    await validateAndSetUser(token.authToken);
    showAppContainer();
  } else {
    showAuthContainer();
  }
}

// Validate token and get user info
async function validateAndSetUser(token) {
  try {
    const response = await fetch('https://proud-porpoise-50.clerk.accounts.dev/oauth/userinfo', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      currentUser = await response.json();
      isAuthenticated = true;
      console.log('User info:', currentUser);
      
      // Notify content script about successful authentication
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'AUTH_STATUS_CHANGED',
            isAuthenticated: true,
            token: token
          });
        }
      });
    } else {
      console.error('Token validation failed:', await response.text());
      throw new Error('Invalid token');
    }
  } catch (error) {
    console.error('Token validation failed:', error);
    await signOut();
  }
}

// Sign in with Clerk using Chrome Identity API
async function signInWithClerk() {
  try {
    const redirectURL = chrome.identity.getRedirectURL();
    console.log('Redirect URL:', redirectURL);
    
    // Generate a longer state parameter (32 characters)
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    console.log('State:', state);
    
    // Example with your instance domain
    const authURLWithInstance = new URL('https://proud-porpoise-50.clerk.accounts.dev/oauth/authorize');
    authURLWithInstance.searchParams.set('response_type', 'code');
    authURLWithInstance.searchParams.set('client_id', CLIENT_ID);
    authURLWithInstance.searchParams.set('redirect_uri', redirectURL);
    authURLWithInstance.searchParams.set('scope', 'profile email');
    authURLWithInstance.searchParams.set('state', state);
    
    console.log('Auth URL:', authURLWithInstance.toString());
    
    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authURLWithInstance.toString(),
      interactive: true
    });
    
    console.log('Full response URL:', responseUrl);
    
    if (responseUrl) {
      const url = new URL(responseUrl);
      console.log('Response URL parts:', {
        protocol: url.protocol,
        host: url.host,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash
      });
      
      // Try both hash and search parameters
      const hash = url.hash.substring(1);
      const search = url.search.substring(1);
      console.log('Hash params:', hash);
      console.log('Search params:', search);
      
      // Try parsing both hash and search
      const hashParams = new URLSearchParams(hash);
      const searchParams = new URLSearchParams(search);
      
      console.log('Parsed hash params:', Object.fromEntries(hashParams.entries()));
      console.log('Parsed search params:', Object.fromEntries(searchParams.entries()));
      
      // Check for authorization code
      const code = hashParams.get('code') || searchParams.get('code');
      console.log('Found code:', code ? 'Yes' : 'No');
      
      if (code) {
        // Exchange code for token
        const tokenParams = {
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code,
          redirect_uri: redirectURL
        };
        
        console.log('Token request to:', TOKEN_ENDPOINT);
        console.log('Token parameters:', tokenParams);
        
        const tokenResponse = await fetch(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          body: new URLSearchParams(tokenParams)
        });

        console.log('Token response status:', tokenResponse.status);
        const responseText = await tokenResponse.text();
        console.log('Token response body:', responseText);

        if (!tokenResponse.ok) {
          throw new Error(`Token exchange failed: ${tokenResponse.status} - ${responseText}`);
        }

        let tokenData;
        try {
          tokenData = JSON.parse(responseText);
        } catch (e) {
          throw new Error(`Failed to parse token response: ${e.message}`);
        }
        
        const token = tokenData.access_token;
        
        if (token) {
          await chrome.storage.local.set({ 
            authToken: token,
            tokenExpiry: Date.now() + (60 * 60 * 1000) // 1 hour expiry
          });
          
          await validateAndSetUser(token);
          showAppContainer();
          initializeApp();
        } else {
          throw new Error('No token received from token exchange');
        }
      } else {
        // Check for error information
        const error = hashParams.get('error') || searchParams.get('error');
        const errorDescription = hashParams.get('error_description') || searchParams.get('error_description');
        
        if (error || errorDescription) {
          throw new Error(`OAuth error: ${error} - ${errorDescription}`);
        } else {
          throw new Error('No authorization code received in response');
        }
      }
    } else {
      throw new Error('No response URL received from auth flow');
    }
  } catch (error) {
    console.error('Authentication failed. Full error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    document.getElementById('auth-error').textContent = `Authentication failed: ${error.message}`;
  }
}

// Sign out
async function signOut() {
  try {
    await chrome.storage.local.remove(['authToken', 'tokenExpiry']);
    isAuthenticated = false;
    currentUser = null;
    showAuthContainer();
  } catch (error) {
    console.error('Sign out failed:', error);
  }
}

// Check if token is expired
async function isTokenExpired() {
  const data = await chrome.storage.local.get(['tokenExpiry']);
  return !data.tokenExpiry || Date.now() > data.tokenExpiry;
}

// UI Helpers
function showAuthContainer() {
  document.getElementById('auth-container').style.display = 'block';
  document.getElementById('app-container').style.display = 'none';
}

function showAppContainer() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';
}

// Function to initialize app features
function initializeApp() {
  if (!isAuthenticated) return;
  
  const positionButtons = document.querySelectorAll('.position-btn');
  const scrapePageBtn = document.getElementById('scrape-page');
  const scrapeSiteBtn = document.getElementById('scrape-site');
  const scrapePatternsBtn = document.getElementById('scrape-patterns');
  const positionStatus = document.getElementById('position-status');
  const scrapeStatus = document.getElementById('scrape-status');
  const patternInput = document.getElementById('pattern-input');
  const addPatternBtn = document.getElementById('add-pattern');
  const patternList = document.getElementById('pattern-list');

  // First remove any existing active classes
  positionButtons.forEach(btn => btn.classList.remove('active'));

  // Load saved position
  chrome.storage.sync.get(['chatPosition'], (result) => {
    const savedPosition = result.chatPosition || 'bottom-left';
    const activeButton = document.querySelector(`[data-position="${savedPosition}"]`);
    if (activeButton) {
      activeButton.classList.add('active');
    } else {
      // If no valid position found, default to bottom-left
      const defaultButton = document.querySelector('[data-position="bottom-left"]');
      if (defaultButton) {
        defaultButton.classList.add('active');
        chrome.storage.sync.set({ chatPosition: 'bottom-left' });
      }
    }
  });

  // Position button click handler
  positionButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons
      positionButtons.forEach(btn => btn.classList.remove('active'));
      
      // Add active class to clicked button
      button.classList.add('active');

      // Save position
      const position = button.dataset.position;
      chrome.storage.sync.set({ chatPosition: position }, () => {
        positionStatus.textContent = 'Position saved';
        setTimeout(() => {
          positionStatus.textContent = '';
        }, 2000);
      });

      // Send message to content script to update position
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { 
            action: 'updatePosition', 
            position: position 
          });
        }
      });
    });
  });

  // Scrape current page button click handler
  scrapePageBtn.addEventListener('click', async () => {
    if (scrapePageBtn.classList.contains('loading')) return;

    scrapePageBtn.classList.add('loading');
    scrapePageBtn.innerHTML = `
      <svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3V6M12 18V21M6 12H3M21 12H18M18.364 18.364L16.243 16.243M7.757 7.757L5.636 5.636M18.364 5.636L16.243 7.757M7.757 16.243L5.636 18.364" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Scraping...
    `;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapePage' });
      
      if (response.success) {
        scrapeStatus.textContent = 'Page scraped successfully!';
      } else {
        scrapeStatus.textContent = 'Failed to scrape page';
      }
    } catch (error) {
      scrapeStatus.textContent = 'Error: Could not scrape page';
    }

    scrapePageBtn.classList.remove('loading');
    scrapePageBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 12L11 14L15 10M12 3L4 7V17L12 21L20 17V7L12 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Scrape Current Page
    `;

    setTimeout(() => {
      scrapeStatus.textContent = '';
    }, 3000);
  });

  // Scrape entire site button click handler
  scrapeSiteBtn.addEventListener('click', async () => {
    if (scrapeSiteBtn.classList.contains('loading')) return;

    scrapeSiteBtn.classList.add('loading');
    scrapeSiteBtn.innerHTML = `
      <svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3V6M12 18V21M6 12H3M21 12H18M18.364 18.364L16.243 16.243M7.757 7.757L5.636 5.636M18.364 5.636L16.243 7.757M7.757 16.243L5.636 18.364" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Scraping Site...
    `;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeSite' });
      
      if (response.success) {
        scrapeStatus.textContent = 'Site scraped successfully!';
      } else {
        scrapeStatus.textContent = 'Failed to scrape site';
      }
    } catch (error) {
      scrapeStatus.textContent = 'Error: Could not scrape site';
    }

    scrapeSiteBtn.classList.remove('loading');
    scrapeSiteBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3L4 7V17L12 21L20 17V7L12 3Z M12 12L20 8M12 12L4 8M12 12V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Scrape Entire Site
    `;

    setTimeout(() => {
      scrapeStatus.textContent = '';
    }, 3000);
  });

  // Scrape patterns button click handler
  scrapePatternsBtn.addEventListener('click', async () => {
    const { urlPatterns } = await chrome.storage.sync.get(['urlPatterns']);
    if (!urlPatterns || urlPatterns.length === 0) {
      scrapeStatus.textContent = 'Please add URL patterns first';
      scrapeStatus.style.color = '#ef4444';
      setTimeout(() => {
        scrapeStatus.textContent = '';
      }, 3000);
      return;
    }

    // Disable button and show loading state
    scrapePatternsBtn.disabled = true;
    scrapePatternsBtn.innerHTML = `
      <svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Scraping...
    `;

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Send message to content script with the specific URLs to scrape
      await chrome.tabs.sendMessage(tab.id, { 
        action: 'scrapePatterns',
        urls: urlPatterns
      });

      // Show success message
      scrapeStatus.textContent = 'Started scraping selected URLs...';
      scrapeStatus.style.color = '#22c55e';
    } catch (error) {
      // Show error message
      scrapeStatus.textContent = 'Error: ' + error.message;
      scrapeStatus.style.color = '#ef4444';
    }

    // Reset button state after delay
    setTimeout(() => {
      scrapePatternsBtn.disabled = false;
      scrapePatternsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 9L12 16L5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Scrape Selected URLs
      `;
      scrapeStatus.textContent = '';
    }, 3000);
  });

  // URL Pattern Management
  // Load saved patterns
  async function loadPatterns() {
    const { urlPatterns } = await chrome.storage.sync.get(['urlPatterns']);
    if (urlPatterns) {
      urlPatterns.forEach(pattern => addPatternToList(pattern));
    }
  }

  // Add pattern to UI
  function addPatternToList(pattern) {
    const item = document.createElement('div');
    item.className = 'pattern-item';
    item.innerHTML = `
      <span>${pattern}</span>
      <button class="remove-pattern">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `;

    const removeBtn = item.querySelector('.remove-pattern');
    removeBtn.addEventListener('click', async () => {
      const { urlPatterns } = await chrome.storage.sync.get(['urlPatterns']);
      const updatedPatterns = urlPatterns.filter(p => p !== pattern);
      await chrome.storage.sync.set({ urlPatterns: updatedPatterns });
      item.remove();
    });

    patternList.appendChild(item);
  }

  // Handle adding new pattern
  addPatternBtn.addEventListener('click', async () => {
    const pattern = patternInput.value.trim();
    if (!pattern) return;

    const { urlPatterns = [] } = await chrome.storage.sync.get(['urlPatterns']);
    if (!urlPatterns.includes(pattern)) {
      urlPatterns.push(pattern);
      await chrome.storage.sync.set({ urlPatterns });
      addPatternToList(pattern);
      patternInput.value = '';
    }
  });

  // Load patterns when popup opens
  loadPatterns();
}

// Initialize app after successful authentication
function initializeApp() {
  // Hide login container
  document.getElementById('login-container').classList.add('hidden');
  
  // Show app container
  document.getElementById('app-container').classList.remove('hidden');
  
  // Get the current auth token
  chrome.storage.local.get(['authToken'], function(result) {
    if (result.authToken) {
      // Notify content script about authentication
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'AUTH_STATUS_CHANGED',
            isAuthenticated: true,
            token: result.authToken
          });
        }
      });
    }
  });
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Check token expiry
  chrome.storage.local.get(['authToken', 'tokenExpiry'], function(result) {
    const currentTime = Date.now();
    const tokenExpiry = result.tokenExpiry;
    
    if (result.authToken && tokenExpiry && currentTime < tokenExpiry) {
      initializeApp();
    } else {
      // Clear expired token
      chrome.storage.local.remove(['authToken', 'tokenExpiry']);
      
      // Show login container
      document.getElementById('login-container').classList.remove('hidden');
      document.getElementById('app-container').classList.add('hidden');
    }
  });
  
  // Check token expiry
  if (await isTokenExpired()) {
    await signOut();
  } else {
    await initializeAuth();
  }
  
  document.getElementById('signin-btn').addEventListener('click', signInWithClerk);
  const signOutBtn = document.getElementById('signout-btn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', signOut);
  }
  
  // Initialize app features if authenticated
  if (isAuthenticated) {
    initializeApp();
  }
});
