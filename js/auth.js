/**
 * auth.js
 * Client-side authentication using localStorage
 * Handles sign in, sign up, session management
 */

const Auth = (() => {
  const STORAGE_KEY = 'clearvox_users';
  const SESSION_KEY = 'clearvox_session';

  /**
   * Get all registered users from localStorage
   */
  function getUsers() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  /**
   * Save users to localStorage
   */
  function saveUsers(users) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
  }

  /**
   * Sign up a new user
   * @returns {{ success: boolean, error?: string, user?: object }}
   */
  function signUp(name, email, password) {
    email = email.trim().toLowerCase();
    name = name.trim();

    if (!name || name.length < 2) {
      return { success: false, error: 'Name must be at least 2 characters' };
    }

    if (!email || !isValidEmail(email)) {
      return { success: false, error: 'Please enter a valid email address' };
    }

    if (!password || password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters' };
    }

    const users = getUsers();

    if (users[email]) {
      return { success: false, error: 'An account with this email already exists' };
    }

    const user = {
      name,
      email,
      password: hashPassword(password),
      createdAt: Date.now()
    };

    users[email] = user;
    saveUsers(users);

    // Auto sign in
    setSession(user);

    return { success: true, user: getSafeUser(user) };
  }

  /**
   * Sign in an existing user
   * @returns {{ success: boolean, error?: string, user?: object }}
   */
  function signIn(email, password) {
    email = email.trim().toLowerCase();

    if (!email || !password) {
      return { success: false, error: 'Please enter email and password' };
    }

    const users = getUsers();
    const user = users[email];

    if (!user) {
      return { success: false, error: 'No account found with this email' };
    }

    if (user.password !== hashPassword(password)) {
      return { success: false, error: 'Incorrect password' };
    }

    setSession(user);
    return { success: true, user: getSafeUser(user) };
  }

  /**
   * Sign in with social (simulated — creates/logs in a demo account)
   */
  function socialSignIn(provider) {
    const demoEmail = `demo_${provider}@clearvox.app`;
    const users = getUsers();

    if (!users[demoEmail]) {
      const user = {
        name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} User`,
        email: demoEmail,
        password: hashPassword('demo123'),
        createdAt: Date.now()
      };
      users[demoEmail] = user;
      saveUsers(users);
    }

    setSession(users[demoEmail]);
    return { success: true, user: getSafeUser(users[demoEmail]) };
  }

  /**
   * Sign out
   */
  function signOut() {
    localStorage.removeItem(SESSION_KEY);
  }

  /**
   * Get current session
   * @returns {object|null}
   */
  function getSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (session && session.email) {
        return session;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  function isAuthenticated() {
    return getSession() !== null;
  }

  // ---- Internal Helpers ----

  function setSession(user) {
    const session = getSafeUser(user);
    session.loginAt = Date.now();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function getSafeUser(user) {
    return {
      name: user.name,
      email: user.email,
      initials: getInitials(user.name)
    };
  }

  function getInitials(name) {
    return name
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  /**
   * Simple hash (not cryptographically secure — demo only)
   */
  function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit int
    }
    return 'h_' + Math.abs(hash).toString(36);
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Public API
  return {
    signUp,
    signIn,
    socialSignIn,
    signOut,
    getSession,
    isAuthenticated
  };
})();
