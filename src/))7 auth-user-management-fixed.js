// Square Trivia - Authentication & User Management System
// Handles user registration, login, profiles, and session management

import React, { createContext, useContext, useState, useEffect } from "react";
const cors = require("cors")({ origin: true });
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  increment,
  addDoc,
} from "firebase/firestore";
// import { httpsCallable } from "firebase/functions";

import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  SUCCESS_MESSAGES,
  VALIDATION_RULES,
  TIERS,
} from "./constants-configuration-fixed";

const {
  validateEmail,
  validateTelegramUsername,
  validatePhone,
  sanitizeInput,
  generateReferralCode,
  createError,
} = require("./utility-functions-fixed");

// import { db, functions } from "./firebase/config";
// import { ERROR_MESSAGES } from "./constants-configuration-fixed";

// =====================================
// AUTH CONTEXT & PROVIDER
// =====================================

const AuthContext = createContext({});

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const auth = getAuth();

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          // Get additional user data from Firestore
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            const data = userDoc.data();
            setUser(firebaseUser);
            setUserData({
              id: firebaseUser.uid,
              ...data,
            });

            // Update last active
            updateDoc(userDocRef, {
              lastActive: serverTimestamp(),
            }).catch(console.error);
          } else {
            // User exists in Auth but not Firestore - shouldn't happen
            console.error("User document not found");
            setUser(null);
            setUserData(null);
          }
        } else {
          setUser(null);
          setUserData(null);
        }
      } catch (error) {
        console.error("Auth state change error:", error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [auth]);

  const value = {
    user,
    userData,
    loading,
    error,
    // Auth functions
    register,
    login,
    logout,
    resetPassword,
    updateUserProfile,
    updateUserPassword,
    checkReferralCode,
    addTelegramToAccount,
    // User data functions
    refreshUserData,
    updateNotificationPreferences,
    updatePayoutMethod,
    getUserStats,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// =====================================
// AUTHENTICATION FUNCTIONS
// =====================================

/**
 * Register new user
 */
async function register(email, password, additionalData = {}) {
  const auth = getAuth();

  try {
    // Validate inputs
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error);
    }

    if (password.length < VALIDATION_RULES.MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Password must be at least ${VALIDATION_RULES.MIN_PASSWORD_LENGTH} characters`
      );
    }

    // Validate additional data
    let hasTelegram = false;
    if (additionalData.telegramUsername) {
      const telegramValidation = validateTelegramUsername(
        additionalData.telegramUsername
      );
      if (!telegramValidation.valid) {
        throw new Error(telegramValidation.error);
      }
      additionalData.telegramUsername = telegramValidation.value;
      hasTelegram = !telegramValidation.isEmpty;
    }

    if (additionalData.phone) {
      const phoneValidation = validatePhone(additionalData.phone);
      if (!phoneValidation.valid) {
        throw new Error(phoneValidation.error);
      }
      additionalData.phone = phoneValidation.value;
    }

    // Check if referral code exists
    let referredBy = null;
    if (additionalData.referralCode) {
      const referralResult = await checkReferralCode(
        additionalData.referralCode
      );
      if (referralResult.valid) {
        referredBy = referralResult.referrerId;
      }
    }

    // Create auth user
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      emailValidation.value,
      password
    );

    const firebaseUser = userCredential.user;

    // Generate unique referral code for new user
    const userReferralCode = await generateUniqueReferralCode();

    // Create user document in Firestore
    const userData = {
      // Required fields
      email: emailValidation.value,
      createdAt: serverTimestamp(),

      // Profile fields
      telegramUsername: additionalData.telegramUsername || null,
      phone: additionalData.phone || null,
      hasTelegram: hasTelegram,
      preferredNotificationMethod: hasTelegram ? "both" : "email",
      referralCode: userReferralCode,
      referredBy: referredBy,

      // Financial fields
      totalDonations: 0,
      lifetimeValue: 0,
      currentTiers: [],
      lastDonation: null,

      // Payout preferences
      payoutMethod: {
        type: null,
        details: {},
        verified: false,
      },

      // Tax information
      taxInfo: {
        ssn_last4: null,
        fullName: null,
        address: null,
        w9_submitted: false,
        total_annual_winnings: 0,
      },

      // Activity tracking
      lastActive: serverTimestamp(),
      loginCount: 1,
      gamesPlayed: 0,
      squaresWon: 0,
      totalWinnings: 0,

      // Preferences
      notifications: {
        email: true,
        telegram: true,
        sms: false,
        marketing: true,
      },

      // System fields
      isAdmin: false,
      isBanned: false,
      banReason: null,
      metadata: {},
    };

    await setDoc(doc(db, "users", firebaseUser.uid), userData);

    // Process referral if applicable
    if (referredBy) {
      await processReferral(referredBy, firebaseUser.uid);
    }

    // Send welcome email (handled by Cloud Function)

    return {
      success: true,
      user: firebaseUser,
      userData: { id: firebaseUser.uid, ...userData },
    };
  } catch (error) {
    console.error("Registration error:", error);

    // Parse Firebase auth errors
    let errorMessage = error.message;
    if (error.code === "auth/email-already-in-use") {
      errorMessage = "This email is already registered";
    } else if (error.code === "auth/weak-password") {
      errorMessage = "Password is too weak";
    }

    throw new Error(errorMessage);
  }
}

/**
 * Login existing user
 */
async function login(email, password) {
  const auth = getAuth();

  try {
    // Validate email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error);
    }

    // Sign in
    const userCredential = await signInWithEmailAndPassword(
      auth,
      emailValidation.value,
      password
    );

    const firebaseUser = userCredential.user;

    // Update login stats
    const userRef = doc(db, "users", firebaseUser.uid);
    await updateDoc(userRef, {
      lastActive: serverTimestamp(),
      loginCount: increment(1),
    });

    // Get user data
    const userDoc = await getDoc(userRef);
    const userData = userDoc.data();

    // Check if user is banned
    if (userData?.isBanned) {
      await signOut(auth);
      throw new Error(
        `Account banned: ${userData.banReason || "Terms violation"}`
      );
    }

    return {
      success: true,
      user: firebaseUser,
      userData: { id: firebaseUser.uid, ...userData },
    };
  } catch (error) {
    console.error("Login error:", error);

    // Parse Firebase auth errors
    let errorMessage = error.message;
    if (error.code === "auth/user-not-found") {
      errorMessage = ERROR_MESSAGES.INVALID_CREDENTIALS;
    } else if (error.code === "auth/wrong-password") {
      errorMessage = ERROR_MESSAGES.INVALID_CREDENTIALS;
    } else if (error.code === "auth/too-many-requests") {
      errorMessage = "Too many failed attempts. Please try again later.";
    }

    throw new Error(errorMessage);
  }
}

/**
 * Logout user
 */
async function logout() {
  const auth = getAuth();

  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    console.error("Logout error:", error);
    throw new Error("Failed to logout");
  }
}

/**
 * Send password reset email
 */
async function resetPassword(email) {
  const auth = getAuth();

  try {
    // Validate email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error);
    }

    await sendPasswordResetEmail(auth, emailValidation.value);

    return {
      success: true,
      message: "Password reset email sent. Check your inbox.",
    };
  } catch (error) {
    console.error("Password reset error:", error);

    let errorMessage = error.message;
    if (error.code === "auth/user-not-found") {
      errorMessage = "No account found with this email";
    }

    throw new Error(errorMessage);
  }
}

// =====================================
// USER PROFILE MANAGEMENT
// =====================================

/**
 * Update user profile
 */
async function updateUserProfile(userId, updates) {
  try {
    // Validate updates
    const validatedUpdates = {};

    if (updates.telegramUsername !== undefined) {
      if (updates.telegramUsername) {
        const validation = validateTelegramUsername(updates.telegramUsername);
        if (!validation.valid) {
          throw new Error(validation.error);
        }
        validatedUpdates.telegramUsername = validation.value;
      } else {
        validatedUpdates.telegramUsername = null;
      }
    }

    if (updates.phone !== undefined) {
      if (updates.phone) {
        const validation = validatePhone(updates.phone);
        if (!validation.valid) {
          throw new Error(validation.error);
        }
        validatedUpdates.phone = validation.value;
      } else {
        validatedUpdates.phone = null;
      }
    }

    // Sanitize other inputs
    if (updates.fullName) {
      validatedUpdates["taxInfo.fullName"] = sanitizeInput(updates.fullName);
    }

    // Update Firestore
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      ...validatedUpdates,
      updatedAt: serverTimestamp(),
    });

    return {
      success: true,
      message: SUCCESS_MESSAGES.PROFILE_UPDATED,
    };
  } catch (error) {
    console.error("Profile update error:", error);
    throw error;
  }
}

/**
 * Update user password
 */
async function updateUserPassword(currentPassword, newPassword) {
  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("No authenticated user");
  }

  try {
    // Validate new password
    if (newPassword.length < VALIDATION_RULES.MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Password must be at least ${VALIDATION_RULES.MIN_PASSWORD_LENGTH} characters`
      );
    }

    // Re-authenticate user
    const credential = EmailAuthProvider.credential(
      user.email,
      currentPassword
    );
    await reauthenticateWithCredential(user, credential);

    // Update password
    await updatePassword(user, newPassword);

    return {
      success: true,
      message: "Password updated successfully",
    };
  } catch (error) {
    console.error("Password update error:", error);

    let errorMessage = error.message;
    if (error.code === "auth/wrong-password") {
      errorMessage = "Current password is incorrect";
    }

    throw new Error(errorMessage);
  }
}

/**
 * Update notification preferences
 */
async function updateNotificationPreferences(userId, preferences) {
  try {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      notifications: preferences,
      updatedAt: serverTimestamp(),
    });

    return { success: true };
  } catch (error) {
    console.error("Notification preferences update error:", error);
    throw error;
  }
}

/**
 * Update payout method
 */
async function updatePayoutMethod(userId, payoutMethod) {
  try {
    // Validate payout method
    const validTypes = ["paypal", "venmo", "zelle", "ach", "check", "crypto"];
    if (!validTypes.includes(payoutMethod.type)) {
      throw new Error("Invalid payout method");
    }

    // Validate method-specific details
    const validatedMethod = {
      type: payoutMethod.type,
      details: {},
      verified: false,
      updatedAt: serverTimestamp(),
    };

    switch (payoutMethod.type) {
      case "paypal":
      case "zelle":
        if (!payoutMethod.email) {
          throw new Error("Email required for this payout method");
        }
        const emailValidation = validateEmail(payoutMethod.email);
        if (!emailValidation.valid) {
          throw new Error(emailValidation.error);
        }
        validatedMethod.details.email = emailValidation.value;
        break;

      case "venmo":
        if (!payoutMethod.username) {
          throw new Error("Username required for Venmo");
        }
        validatedMethod.details.username = sanitizeInput(payoutMethod.username);
        break;

      case "ach":
        if (!payoutMethod.accountNumber || !payoutMethod.routingNumber) {
          throw new Error("Account and routing numbers required for ACH");
        }
        validatedMethod.details.accountNumber = payoutMethod.accountNumber;
        validatedMethod.details.routingNumber = payoutMethod.routingNumber;
        break;

      case "check":
        if (!payoutMethod.mailingAddress) {
          throw new Error("Mailing address required for check");
        }
        validatedMethod.details.mailingAddress = {
          street1: sanitizeInput(payoutMethod.mailingAddress.street1),
          street2: sanitizeInput(payoutMethod.mailingAddress.street2 || ""),
          city: sanitizeInput(payoutMethod.mailingAddress.city),
          state: sanitizeInput(payoutMethod.mailingAddress.state),
          zip: sanitizeInput(payoutMethod.mailingAddress.zip),
        };
        break;

      case "crypto":
        if (!payoutMethod.walletAddress || !payoutMethod.cryptoType) {
          throw new Error("Wallet address and crypto type required");
        }
        validatedMethod.details.walletAddress = payoutMethod.walletAddress;
        validatedMethod.details.cryptoType = payoutMethod.cryptoType;
        break;
    }

    // Update user document
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      payoutMethod: validatedMethod,
    });

    return {
      success: true,
      message: "Payout method updated successfully",
    };
  } catch (error) {
    console.error("Payout method update error:", error);
    throw error;
  }
}

/**
 * Add Telegram to existing account
 */
export async function addTelegramToAccount(userId, telegramUsername) {
  console.log("Hello from frontend!");

  try {
    const validation = validateTelegramUsername(telegramUsername);
    if (!validation.valid || validation.isEmpty) {
      throw new Error(
        validation.error || "Please enter a valid Telegram username"
      );
    }

    // Update user profile
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      telegramUsername: validation.value,
      hasTelegram: true,
      preferredNotificationMethod: "both",
      updatedAt: serverTimestamp(),
    });

    // Grant any active tier Telegram access
    const user = await getDoc(userRef);
    const userData = user.data();

    if (userData.currentTiers && userData.currentTiers.length > 0) {
      // Create function call to grant Telegram access for all active tiers
      for (const tier of userData.currentTiers) {
        await httpsCallable(
          functions,
          "grantTelegramAccessForTier"
        )({
          userId,
          tier,
          telegramUsername: validation.value,
        });
      }
    }

    return {
      success: true,
      message:
        "Telegram added successfully! You now have access to all benefits.",
      benefits: {
        extraAttempts: 5,
        instantNotifications: true,
        communityAccess: true,
      },
    };
  } catch (error) {
    console.error("Add Telegram error:", error);
    throw error;
  }
}

// =====================================
// USER DATA FUNCTIONS
// =====================================

/**
 * Refresh user data from Firestore
 */
async function refreshUserData(userId) {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (!userDoc.exists()) {
      throw new Error("User not found");
    }

    return {
      id: userId,
      ...userDoc.data(),
    };
  } catch (error) {
    console.error("Refresh user data error:", error);
    throw error;
  }
}

/**
 * Get user statistics
 */
async function getUserStats(userId) {
  try {
    // Get user's squares
    const squaresQuery = query(
      collection(db, "squareClaims"),
      where("userId", "==", userId)
    );
    const squaresSnapshot = await getDocs(squaresQuery);

    // Get user's wins
    const winsQuery = query(
      collection(db, "winners"),
      where("userId", "==", userId)
    );
    const winsSnapshot = await getDocs(winsQuery);

    // Initialize stats
    const stats = {
      totalSquares: squaresSnapshot.size,
      totalWins: winsSnapshot.size,
      totalPrizeAmount: 0,
      winsByTier: {},
      recentWins: [],
      averageAnswerTime: 0,
      fastestAnswerTime: 0,
    };

    // --- Process wins ---
    winsSnapshot.forEach((doc) => {
      const win = doc.data();
      stats.totalPrizeAmount += win.prizeAmount || 0;

      // Count by tier
      const tier = win.tierId || "unknown";
      stats.winsByTier[tier] = (stats.winsByTier[tier] || 0) + 1;

      // Add to recent wins
      stats.recentWins.push({
        id: doc.id,
        ...win,
      });
    });

    // Sort and limit recent wins
    stats.recentWins.sort(
      (a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
    );
    stats.recentWins = stats.recentWins.slice(0, 10);

    // --- Process answer times ---
    let totalTime = 0;
    let validCount = 0;
    let fastest = Infinity;

    squaresSnapshot.forEach((doc) => {
      const data = doc.data();
      if (typeof data.answerTime === "number" && data.answerTime > 0) {
        totalTime += data.answerTime;
        validCount++;
        if (data.answerTime < fastest) fastest = data.answerTime;
      }
    });

    if (validCount > 0) {
      stats.averageAnswerTime = totalTime / validCount;
      stats.fastestAnswerTime = fastest === Infinity ? 0 : fastest;
    }

    return stats;
  } catch (error) {
    console.error("Get user stats error:", error);
    throw error;
  }
}

// =====================================
// REFERRAL SYSTEM
// =====================================

/**
 * Generate unique referral code
 */
async function generateUniqueReferralCode() {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const code = generateReferralCode();

    // Check if code exists
    const existingQuery = query(
      collection(db, "users"),
      where("referralCode", "==", code)
    );
    const existing = await getDocs(existingQuery);

    if (existing.empty) {
      return code;
    }

    attempts++;
  }

  throw new Error("Failed to generate unique referral code");
}

/**
 * Check if referral code is valid
 */
async function checkReferralCode(code) {
  try {
    const usersQuery = query(
      collection(db, "users"),
      where("referralCode", "==", code.toUpperCase())
    );
    const snapshot = await getDocs(usersQuery);

    if (snapshot.empty) {
      return { valid: false };
    }

    const referrer = snapshot.docs[0];
    return {
      valid: true,
      referrerId: referrer.id,
      referrerData: referrer.data(),
    };
  } catch (error) {
    console.error("Check referral code error:", error);
    return { valid: false };
  }
}

/**
 * Process referral
 */
async function processReferral(referrerId, referredId) {
  try {
    // Create referral record
    await addDoc(collection(db, "referrals"), {
      referrerId,
      referredId,
      status: "pending",
      creditAmount: 25, // $25 credit
      createdAt: serverTimestamp(),
    });

    // Update referrer's count
    const referrerRef = doc(db, "users", referrerId);
    await updateDoc(referrerRef, {
      referredUsers: increment(1),
    });
  } catch (error) {
    console.error("Process referral error:", error);
    // Don't throw - referral is not critical
  }
}

// =====================================
// REACT COMPONENTS
// =====================================

/**
 * Login form component
 */
export function LoginForm({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await login(email, password);
      onSuccess?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Email</label>
        <input
          title="Enter your email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          title="Enter your password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 hover:text-white"
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}

/**
 * Registration form component
 */
export function RegistrationForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    telegramUsername: "",
    phone: "",
    referralCode: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    try {
      const result = await register(formData.email, formData.password, {
        telegramUsername: formData.telegramUsername,
        phone: formData.phone,
        referralCode: formData.referralCode,
      });
      onSuccess?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Email *
        </label>
        <input
          title="Enter your email"
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Password *
        </label>
        <input
          title="Enter your password"
          type="password"
          name="password"
          value={formData.password}
          onChange={handleChange}
          required
          minLength={VALIDATION_RULES.MIN_PASSWORD_LENGTH}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          At least {VALIDATION_RULES.MIN_PASSWORD_LENGTH} characters
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Confirm Password *
        </label>
        <input
          title="Confirm your password"
          type="password"
          name="confirmPassword"
          value={formData.confirmPassword}
          onChange={handleChange}
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Telegram Username
          <span className="text-gray-500 text-xs ml-2">
            (Optional - Recommended for best experience)
          </span>
        </label>
        <input
          title="Enter your telegram username"
          type="text"
          name="telegramUsername"
          value={formData.telegramUsername}
          onChange={handleChange}
          placeholder="@username (optional)"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
        <div className="mt-2 p-3 bg-blue-50 rounded-lg text-xs">
          <p className="font-semibold text-blue-900 mb-1">Why add Telegram?</p>
          <ul className="space-y-0.5 text-blue-800">
            <li>• Get 10 daily trivia attempts instead of 5</li>
            <li>• Receive instant winner notifications</li>
            <li>• Join exclusive community groups</li>
            <li>• Access priority support</li>
          </ul>
          <p className="text-blue-600 mt-2">
            You can always add it later from your account settings!
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Phone Number
        </label>
        <input
          title="Enter your phone number"
          type="tel"
          name="phone"
          value={formData.phone}
          onChange={handleChange}
          placeholder="(555) 123-4567"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          Optional - for SMS notifications
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Referral Code
        </label>
        <input
          title="Enter referral code"
          type="text"
          name="referralCode"
          value={formData.referralCode}
          onChange={handleChange}
          placeholder="FRIEND123"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 hover:text-white"
      >
        {loading ? "Creating Account..." : "Create Account"}
      </button>
    </form>
  );
}

/**
 * User profile component
 */
export function UserProfile() {
  const { userData, refreshUserData } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userData?.id) {
      getUserStats(userData.id)
        .then(setStats)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [userData]);

  if (!userData) {
    return <div>Please log in to view your profile.</div>;
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-2xl font-bold mb-6">Your Profile</h2>

      {/* Basic Info */}
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Account Information</h3>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-gray-500">Email</dt>
            <dd className="text-sm text-gray-900">{userData.email}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Member Since</dt>
            <dd className="text-sm text-gray-900">
              {userData.createdAt?.toDate?.().toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Telegram</dt>
            <dd className="text-sm text-gray-900">
              {userData.telegramUsername || "Not set"}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Phone</dt>
            <dd className="text-sm text-gray-900">
              {userData.phone || "Not set"}
            </dd>
          </div>
        </dl>
      </div>

      {/* Stats */}
      {stats && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-3">Your Stats</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-2xl font-bold text-blue-600">
                {stats.totalSquares}
              </div>
              <div className="text-sm text-gray-500">Squares Earned</div>
            </div>
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-2xl font-bold text-green-600">
                {stats.totalWins}
              </div>
              <div className="text-sm text-gray-500">Wins</div>
            </div>
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-2xl font-bold text-green-600">
                ${stats.totalPrizeAmount.toFixed(2)}
              </div>
              <div className="text-sm text-gray-500">Total Won</div>
            </div>
            <div className="bg-gray-50 p-4 rounded">
              <div className="text-2xl font-bold text-purple-600">
                ${userData.totalDonations || 0}
              </div>
              <div className="text-sm text-gray-500">Total Donated</div>
            </div>
          </div>
        </div>
      )}

      {/* Active Tiers */}
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Active Tiers</h3>
        {userData.currentTiers?.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {userData.currentTiers.map((tierId) => {
              const tier = TIERS[tierId.toUpperCase().replace("_", "_")];
              return tier ? (
                <span
                  key={tierId}
                  className={`px-3 py-1 rounded-full text-sm font-medium text-white ${tier.color}`}
                >
                  {tier.label}
                </span>
              ) : null;
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No active tiers</p>
        )}
      </div>

      {/* Referral Code */}
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Your Referral Code</h3>
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-2xl font-mono font-bold text-blue-600">
            {userData.referralCode}
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Share this code with friends. You'll both receive benefits when they
            sign up!
          </p>
        </div>
      </div>
    </div>
  );
}

// =====================================
// AUTH GUARD COMPONENTS
// =====================================

/**
 * Protected route wrapper
 */
export function ProtectedRoute({ children, adminOnly = false }) {
  const { user, userData, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">Please log in to access this page.</p>
        <a href="/login" className="text-blue-600 hover:underline">
          Go to Login
        </a>
      </div>
    );
  }

  if (adminOnly && !userData?.isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">
          Access denied. Admin privileges required.
        </p>
      </div>
    );
  }

  return children;
}

// =====================================
// EXPORTS
// =====================================

export default {
  // Context and hooks
  AuthProvider,
  useAuth,

  // Auth functions
  register,
  login,
  logout,
  resetPassword,

  // Profile functions
  updateUserProfile,
  updateUserPassword,
  updateNotificationPreferences,
  updatePayoutMethod,
  addTelegramToAccount,

  // Data functions
  refreshUserData,
  getUserStats,
  checkReferralCode,

  // Components
  LoginForm,
  RegistrationForm,
  UserProfile,
  ProtectedRoute,
};
