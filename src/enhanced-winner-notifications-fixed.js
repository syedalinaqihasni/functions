// Square Trivia - Winner Processing & Notifications System
// Handles all winner notifications via email, Telegram, and SMS
// Updated for skill-based competition system with enhanced timing reveal messaging

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const TelegramBot = require("node-telegram-bot-api");
const twilio = require("twilio");
const sgMail = require("@sendgrid/mail");

// Import from constants/config using CommonJS
const {
  NOTIFICATION_CONFIG,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  TIERS,
  GAME_CONFIG,
  getTierById,
} = require("./constants-configuration-fixed");

// Import from utils/utilities using CommonJS
const {
  getTimestamp,
  formatTimestamp,
  logError,
  retryOperation,
  createError,
  safeTransaction,
  sanitizeInput,
} = require("./utility-functions-fixed");

// Payment structure constants
// These will eventually come from constants-configuration.js
const INSTANT_PAYOUT_FEE = 0.08; // 8% fee for instant payouts
const BATCH_PAYOUT_DAYS = ["tuesday", "friday"];
const BATCH_PAYOUT_SCHEDULE = {
  tuesday: {
    processes: "Friday - Monday games",
    nextDay: "friday",
  },
  friday: {
    processes: "Tuesday - Thursday games",
    nextDay: "tuesday",
  },
};

// IMPORTANT: Tier names remain unchanged throughout the system
// Lower 3 tiers: $25 Tier, $50 Tier, $100 Tier (77% payout)
// Upper 3 tiers: $250 Tier, $500 Tier, $1000 Tier (80% payout)

// =====================================
// HELPER FUNCTIONS
// =====================================

/**
 * Generate secure token for payout choice URL
 */
function generateSecureToken() {
  return (
    admin.firestore().collection("temp").doc().id + Date.now().toString(36)
  );
}

/**
 * Calculate instant payout amount after fee
 */
function calculateInstantPayout(prizeAmount) {
  const fee = prizeAmount * INSTANT_PAYOUT_FEE;
  const netAmount = prizeAmount - fee;
  return {
    originalAmount: prizeAmount,
    fee: fee,
    netAmount: netAmount,
    feePercentage: INSTANT_PAYOUT_FEE * 100,
  };
}

/**
 * Get next batch payout date
 */
function getNextBatchPayoutDate() {
  const today = new Date();
  const dayOfWeek = today.getDay();

  // Tuesday = 2, Friday = 5
  let daysUntilNext;

  if (dayOfWeek <= 2) {
    // Sunday (0), Monday (1), Tuesday (2) -> next Tuesday
    daysUntilNext = 2 - dayOfWeek;
  } else if (dayOfWeek <= 5) {
    // Wednesday (3), Thursday (4), Friday (5) -> next Friday
    daysUntilNext = 5 - dayOfWeek;
  } else {
    // Saturday (6) -> next Tuesday
    daysUntilNext = 3;
  }

  if (daysUntilNext === 0) {
    // If it's already Tuesday or Friday, next batch is the following one
    daysUntilNext = dayOfWeek === 2 ? 3 : 4; // Tuesday -> Friday, Friday -> Tuesday
  }

  const nextBatchDate = new Date(today);
  nextBatchDate.setDate(today.getDate() + daysUntilNext);

  return nextBatchDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Get payout percentage based on tier
 * Lower 3 tiers ($25, $50, $100): 77%
 * Upper 3 tiers ($250, $500, $1000): 80%
 */
function getPayoutPercentage(tierId) {
  const lowerTiers = ["tier_25", "tier_50", "tier_100"];
  return lowerTiers.includes(tierId) ? 0.77 : 0.8;
}

// =====================================
// EMAIL SERVICE
// =====================================

class EmailService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      // Use your SendGrid API key from environment variable
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      this.initialized = true;
      console.log("SendGrid email service initialized successfully");
    } catch (error) {
      logError(error, { context: "EmailService.initialize" });
      throw new Error("Failed to initialize SendGrid service");
    }
  }

  async sendEmail(to, subject, html, attachments = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    const msg = {
      to,
      from: NOTIFICATION_CONFIG.EMAIL.FROM_ADDRESS, // must be a verified SendGrid sender
      subject,
      html,
      attachments: attachments.map((att) => ({
        content: att.content.toString("base64"),
        filename: att.filename,
        type: att.contentType,
        disposition: "attachment",
      })),
    };

    return await retryOperation(
      async () => {
        const response = await sgMail.send(msg);
        console.log(
          `Email sent to ${to} via SendGrid: ${response[0].statusCode}`
        );
        return response;
      },
      3,
      1000
    );
  }

  /**
   * Get email template
   */
  getTemplate(templateName, data) {
    const templates = {
      winner: this.getWinnerTemplate(data),
      winner_enhanced: this.getWinnerEnhancedTemplate(data),
      square_assigned: this.getSquareAssignedTemplate(data),
      donation_confirm: this.getDonationConfirmTemplate(data),
      payout_sent: this.getPayoutSentTemplate(data),
      welcome: this.getWelcomeTemplate(data),
      instant_payout_confirmation:
        this.getInstantPayoutConfirmationTemplate(data),
      batch_payout_queued: this.getBatchPayoutQueuedTemplate(data),
      payout_choice_reminder: this.getPayoutChoiceReminderTemplate(data),
      consolation_prize: this.getConsolationTemplate(data),
    };

    return templates[templateName] || "";
  }

  /**
   * Winner notification template - ENHANCED WITH TIMING REVEAL EXCITEMENT
   */
  getWinnerTemplate(data) {
    const {
      game,
      quarter,
      score,
      position,
      prizeAmount,
      tier,
      tierId,
      winnerTime,
      loserTime,
      hasLoser,
    } = data;

    // Calculate instant payout option (8% fee)
    const instantPayoutFee = prizeAmount * 0.08;
    const instantPayoutAmount = prizeAmount - instantPayoutFee;

    // Get payout percentage for tier
    const payoutPercentage = getPayoutPercentage(tierId);
    const payoutPercentageDisplay = payoutPercentage === 0.77 ? "77%" : "80%";

    // Enhanced skill victory section with timing reveal excitement
    const skillSection = hasLoser
      ? `
      <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); padding: 30px; border-radius: 16px; margin: 30px 0; border: 2px solid #f97316;">
        <h3 style="margin-top: 0; color: #ea580c; font-size: 26px; text-align: center;">
          🎯 The Moment of Truth Has Arrived! 🎯
        </h3>
        <p style="text-align: center; font-size: 18px; color: #92400e; margin: 20px 0;">
          <strong>Your opponent's speed has finally been revealed...</strong>
        </p>
        
        <div style="background-color: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <div style="display: flex; justify-content: space-around; margin: 20px 0;">
            <div style="text-align: center;">
              <div style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">YOUR TIME</div>
              <div style="font-size: 42px; font-weight: bold; color: #16a34a;">${winnerTime}s</div>
              <div style="color: #16a34a; margin-top: 5px; font-weight: 600;">WINNER! 🏆</div>
            </div>
            <div style="font-size: 28px; align-self: center; color: #d97706;">⚡</div>
            <div style="text-align: center;">
              <div style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">OPPONENT'S TIME</div>
              <div style="font-size: 42px; font-weight: bold; color: #dc2626;">${loserTime}s</div>
              <div style="color: #dc2626; margin-top: 5px;">Too Slow</div>
            </div>
          </div>
          
          <div style="text-align: center; background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 20px; border-radius: 12px; margin-top: 25px;">
            <p style="margin: 0; font-size: 24px; font-weight: bold;">
              You were ${(loserTime - winnerTime).toFixed(1)} seconds faster! 🚀
            </p>
            <p style="margin: 10px 0 0 0; font-size: 16px;">
              Your lightning-fast reflexes earned you the victory!
            </p>
          </div>
        </div>
        
        <p style="text-align: center; color: #7c2d12; font-style: italic; margin: 20px 0 0 0; font-size: 14px;">
          Times were hidden until this winning moment to keep the competition fair and exciting!
        </p>
      </div>
    `
      : `
      <div style="background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); padding: 30px; border-radius: 16px; margin: 30px 0; border: 2px solid #0066FF;">
        <h3 style="margin-top: 0; color: #0066FF; font-size: 24px;">🎯 Solo Square Winner!</h3>
        <p style="font-size: 18px; margin: 15px 0;">You were the only player on this square.</p>
        <div style="text-align: center; margin: 20px 0;">
          <div style="font-size: 36px; font-weight: bold; color: #16a34a;">${winnerTime}s</div>
          <div style="color: #6b7280; margin-top: 5px;">Your Answer Time</div>
        </div>
        <div style="background-color: #0066FF; color: white; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <p style="margin: 0; font-size: 18px;">
            No competition needed - you automatically win! 🏆
          </p>
        </div>
      </div>
    `;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      color: #333; 
      margin: 0;
      padding: 0;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: #ffffff;
    }
    .header { 
      background: linear-gradient(135deg, #0066FF 0%, #004ACC 100%);
      color: white; 
      padding: 40px 20px; 
      text-align: center;
      border-radius: 0 0 20px 20px;
    }
    .header h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 700;
    }
    .content { 
      padding: 40px 20px;
    }
    .prize-box { 
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border: 2px solid #0066FF;
      padding: 30px; 
      border-radius: 16px; 
      margin: 30px 0; 
      text-align: center;
    }
    .prize-amount { 
      font-size: 48px; 
      color: #0066FF; 
      font-weight: 800;
      margin: 10px 0;
    }
    .prize-info {
      font-size: 14px;
      color: #6b7280;
      margin-top: 10px;
    }
    .details { 
      background-color: #f8fafc; 
      padding: 20px; 
      border-radius: 12px; 
      margin: 20px 0;
      border-left: 4px solid #0066FF;
    }
    .details-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .details-row:last-child {
      border-bottom: none;
    }
    .payout-options {
      background-color: #fff7ed;
      border: 2px solid #f97316;
      padding: 30px;
      border-radius: 16px;
      margin: 30px 0;
    }
    .payout-option {
      background-color: white;
      border: 2px solid #e5e7eb;
      padding: 20px;
      border-radius: 12px;
      margin: 15px 0;
      cursor: pointer;
      transition: all 0.2s;
    }
    .payout-option:hover {
      border-color: #0066FF;
      box-shadow: 0 4px 12px rgba(0, 102, 255, 0.15);
    }
    .payout-option h4 {
      margin: 0 0 10px 0;
      color: #0066FF;
      font-size: 20px;
    }
    .payout-amount-display {
      font-size: 28px;
      font-weight: 700;
      color: #16a34a;
      margin: 5px 0;
    }
    .payout-timing {
      color: #6b7280;
      font-size: 14px;
      margin-top: 5px;
    }
    .payout-fee {
      color: #dc2626;
      font-size: 14px;
      margin-top: 5px;
    }
    .button { 
      display: inline-block;
      background-color: #0066FF; 
      color: white; 
      padding: 16px 32px; 
      text-decoration: none; 
      border-radius: 8px; 
      font-weight: 600;
      margin: 20px 0;
    }
    .footer {
      background-color: #f8fafc;
      padding: 30px 20px;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }
    .celebration {
      font-size: 60px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏆 Congratulations! You're a Winner! 🏆</h1>
    </div>
    
    <div class="content">
      <div class="celebration" style="text-align: center;">🎉</div>
      
      <p style="font-size: 18px; text-align: center; color: #4b5563;">
        Great news! Your square hit in the <strong>${quarter}</strong> of the game!
      </p>
      
      ${skillSection}
      
      <div class="details">
        <div class="details-row">
          <strong>Game:</strong>
          <span>${sanitizeInput(game)}</span>
        </div>
        <div class="details-row">
          <strong>Quarter:</strong>
          <span>${quarter}</span>
        </div>
        <div class="details-row">
          <strong>Final Score:</strong>
          <span>${score}</span>
        </div>
        <div class="details-row">
          <strong>Your Square:</strong>
          <span>#${position}</span>
        </div>
        <div class="details-row">
          <strong>Tier:</strong>
          <span>${tier}</span>
        </div>
      </div>
      
      <div class="prize-box">
        <div style="color: #6b7280; font-size: 18px;">You won:</div>
        <div class="prize-amount">$${prizeAmount.toFixed(2)}</div>
        <div class="prize-info">From ${tier} contest prizes (${payoutPercentageDisplay} of total pot)</div>
      </div>
      
      <div class="payout-options">
        <h3 style="margin-top: 0; color: #ea580c;">💸 Choose Your Payout Speed:</h3>
        
        <div class="payout-option">
          <h4>⚡ Instant Payout</h4>
          <div class="payout-amount-display">$${instantPayoutAmount.toFixed(2)}</div>
          <div class="payout-timing">Get paid TODAY!</div>
          <div class="payout-fee">8% processing fee = $${instantPayoutFee.toFixed(2)} deducted</div>
        </div>
        
        <div class="payout-option">
          <h4>📅 Standard Payout</h4>
          <div class="payout-amount-display">$${prizeAmount.toFixed(2)}</div>
          <div class="payout-timing">Get full amount in 2-3 business days</div>
          <div style="color: #16a34a; font-size: 14px; margin-top: 5px;">No fees - receive 100% of your prize!</div>
        </div>
        
        <p style="text-align: center; margin-top: 20px;">
          <a href="https://squaretrivia.com/winners/payout-choice/${data.winnerId || ""}?token=${data.payoutChoiceToken || ""}" class="button">Choose Payout Method</a>
        </p>
      </div>
      
      <h3 style="margin-top: 40px;">What Happens Next?</h3>
      <ol style="color: #4b5563; padding-left: 20px;">
        <li>Choose your payout speed above</li>
        <li>Your prize will be processed based on your choice</li>
        <li>You'll receive a confirmation email when payment is sent</li>
        <li>For prizes over $600, tax forms will be provided</li>
      </ol>
      
      <div style="text-align: center; margin: 40px 0;">
        <a href="https://squaretrivia.com/winners" class="button">View Your Wins</a>
      </div>
    </div>
    
    <div class="footer">
      <p>This is an automated notification from Square Trivia.<br>
      Your win has been recorded and verified.</p>
      <p style="margin-top: 20px;">
        Need help? Contact us at ${NOTIFICATION_CONFIG.EMAIL.SUPPORT_ADDRESS}
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Enhanced winner template for non-Telegram users
   */
  getWinnerEnhancedTemplate(data) {
    const baseTemplate = this.getWinnerTemplate(data);

    // Insert Telegram benefits section before the footer
    const telegramSection = `
    <div style="background-color: #E3F2FD; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: center;">
      <h3 style="color: #0066FF; margin-top: 0;">⚡ Get Instant Notifications!</h3>
      <p style="font-size: 16px; margin: 15px 0;">Add Telegram to your account to:</p>
      <ul style="text-align: left; display: inline-block; margin: 10px 0;">
        <li>Receive instant winner notifications</li>
        <li>Get 2x more daily trivia attempts (10 vs 5)</li>
        <li>Join our player community</li>
        <li>Access priority support</li>
      </ul>
      <a href="https://squaretrivia.com/account/add-telegram" 
         style="background-color: #0066FF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">
        Add Telegram to My Account
      </a>
      <p style="font-size: 12px; color: #666; margin-top: 10px;">
        You can continue using Square Trivia without Telegram, but you'll love the extra features!
      </p>
    </div>
    `;

    // Insert before the footer
    return baseTemplate.replace(
      '<div class="footer">',
      telegramSection + '<div class="footer">'
    );
  }

  /**
   * Consolation prize template - ENHANCED WITH CLOSE CALL MESSAGING
   */
  getConsolationTemplate(data) {
    const { userId, nextBoardId, game, winnerTime, loserTime } = data;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      color: #333; 
      margin: 0;
      padding: 0;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: #ffffff;
    }
    .header { 
      background: linear-gradient(135deg, #FF9800 0%, #F57C00 100%);
      color: white; 
      padding: 40px 20px; 
      text-align: center;
      border-radius: 0 0 20px 20px;
    }
    .header h1 {
      margin: 0;
      font-size: 32px;
      font-weight: 700;
    }
    .content { 
      padding: 40px 20px;
    }
    .consolation-box {
      background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
      border: 2px solid #FF9800;
      padding: 30px;
      border-radius: 16px;
      margin: 30px 0;
      text-align: center;
    }
    .time-reveal {
      background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
      padding: 25px;
      border-radius: 12px;
      margin: 20px 0;
      border: 2px solid #ef5350;
    }
    .free-square-box {
      background-color: #e8f5e9;
      border: 2px solid #4caf50;
      padding: 25px;
      border-radius: 12px;
      margin: 30px 0;
      text-align: center;
    }
    .button { 
      display: inline-block;
      background-color: #FF9800; 
      color: white; 
      padding: 16px 32px; 
      text-decoration: none; 
      border-radius: 8px; 
      font-weight: 600;
      margin: 20px 0;
    }
    .footer {
      background-color: #f8fafc;
      padding: 30px 20px;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎁 So Close! You Earned a Consolation Prize! 🎁</h1>
    </div>
    
    <div class="content">
      <p style="font-size: 20px; text-align: center; color: #4b5563;">
        <strong>Your square hit, but the times have been revealed...</strong>
      </p>
      
      <div class="time-reveal">
        <h3 style="margin-top: 0; color: #c62828; font-size: 24px;">⏱️ The Moment of Truth</h3>
        <p style="font-size: 16px; margin: 15px 0;">
          After keeping times hidden for fair competition, we can now reveal:
        </p>
        <div style="display: flex; justify-content: space-around; margin: 25px 0;">
          <div style="text-align: center;">
            <div style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">WINNER'S TIME</div>
            <div style="font-size: 36px; font-weight: bold; color: #16a34a;">${winnerTime}s</div>
            <div style="color: #16a34a; margin-top: 5px;">Fastest! 🏆</div>
          </div>
          <div style="font-size: 24px; align-self: center; color: #ef5350;">VS</div>
          <div style="text-align: center;">
            <div style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">YOUR TIME</div>
            <div style="font-size: 36px; font-weight: bold; color: #d32f2f;">${loserTime}s</div>
            <div style="color: #d32f2f; margin-top: 5px;">So close!</div>
          </div>
        </div>
        <div style="background-color: white; padding: 15px; border-radius: 8px; margin-top: 20px;">
          <p style="text-align: center; color: #b71c1c; font-weight: bold; margin: 0; font-size: 18px;">
            You were just ${(loserTime - winnerTime).toFixed(1)} seconds away from victory! 😱
          </p>
        </div>
      </div>
      
      <div class="consolation-box">
        <h2 style="margin-top: 0; color: #F57C00; font-size: 28px;">But you're not going empty-handed!</h2>
        <p style="font-size: 18px; margin: 20px 0;">
          For demonstrating your skill and earning a winning square, you've been awarded:
        </p>
        <div style="font-size: 36px; font-weight: bold; color: #FF6F00; margin: 20px 0;">
          1 FREE SQUARE! 🎯
        </div>
      </div>
      
      <div class="free-square-box">
        <h3 style="margin-top: 0; color: #2e7d32;">Your Free Square Details</h3>
        <p style="font-size: 20px; font-weight: bold; margin: 15px 0;">
          ${sanitizeInput(game.teams.away)} @ ${sanitizeInput(game.teams.home)}
        </p>
        <p style="color: #666; font-size: 16px;">
          ${new Date(game.startTime.toMillis()).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
        <div style="background-color: #fff; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>✅ No trivia required</strong></p>
          <p style="margin: 5px 0;"><strong>✅ Choose any available position</strong></p>
          <p style="margin: 5px 0;"><strong>✅ Valid for 30 days</strong></p>
        </div>
      </div>
      
      <h3 style="margin-top: 40px;">How to Claim Your Free Square:</h3>
      <ol style="color: #4b5563; padding-left: 20px; font-size: 16px;">
        <li>Visit the board for the upcoming game</li>
        <li>Click "Use Free Square" button</li>
        <li>Select any available position (max 2 players per square)</li>
        <li>Your square will be instantly assigned - no trivia needed!</li>
      </ol>
      
      <p style="text-align: center; margin: 40px 0;">
        <a href="https://squaretrivia.com/boards/${nextBoardId}" class="button">
          Claim Your Free Square Now
        </a>
      </p>
      
      <div style="background-color: #fff3e0; padding: 20px; border-radius: 8px; border: 1px solid #FF9800;">
        <h4 style="margin-top: 0; color: #F57C00;">Important Notes:</h4>
        <ul style="margin: 10px 0; padding-left: 20px;">
          <li>This free square expires in 30 days</li>
          <li>Consolation squares cannot earn additional free squares if they lose</li>
          <li>Maximum 4 consolation squares awarded per board</li>
          <li>Cannot be used on back-to-back games</li>
        </ul>
      </div>
    </div>
    
    <div class="footer">
      <p>This is an automated notification from Square Trivia.<br>
      Your consolation prize has been recorded.</p>
      <p style="margin-top: 20px;">
        Need help? Contact us at ${NOTIFICATION_CONFIG.EMAIL.SUPPORT_ADDRESS}
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Square assigned template
   */
  getSquareAssignedTemplate(data) {
    const { game, position, boardId } = data;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066FF; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .square-number { font-size: 64px; font-weight: bold; color: #0066FF; margin: 20px 0; }
    .content { background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Your Square Has Been Assigned! 🎯</h2>
    </div>
    <div class="content" style="text-align: center;">
      <p style="font-size: 18px;">You've been randomly assigned:</p>
      <div class="square-number">#${position}</div>
      <p style="font-size: 16px;">For the game:</p>
      <p style="font-size: 20px; font-weight: bold;">${sanitizeInput(game)}</p>
      
      <div style="background-color: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0;">
        <p style="margin: 0;"><strong>How to Win:</strong></p>
        <p style="margin: 10px 0 0 0;">If the last digit of each team's score matches your square position, you win! We'll notify you immediately if your square hits.</p>
      </div>
      
      <p style="color: #666; font-size: 14px;">
        Board ID: ${boardId}<br>
        Good luck! 🍀
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Donation confirmation template
   */
  getDonationConfirmTemplate(data) {
    const { amount, tier, telegramUsername } = data;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #10b981; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px; }
    .tier-badge { 
      display: inline-block; 
      background-color: #0066FF; 
      color: white; 
      padding: 10px 20px; 
      border-radius: 20px; 
      font-weight: bold;
      font-size: 18px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Thank You for Your Support! 💙</h2>
    </div>
    <div class="content">
      <p style="font-size: 18px;">Your entry fee has been processed successfully!</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <div>You now have access to:</div>
        <div class="tier-badge">${tier}</div>
      </div>
      
      <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">What's Next?</h3>
        <ol style="margin-bottom: 0;">
          <li>Join the Telegram group for your tier</li>
          <li>Answer trivia questions correctly to earn squares</li>
          <li>Place squares on available game boards</li>
          <li>Win prizes when your squares hit!</li>
        </ol>
      </div>
      
      ${
        telegramUsername
          ? `
      <div style="background-color: #e3f2fd; padding: 15px; border-radius: 8px;">
        <p style="margin: 0;"><strong>Telegram Access:</strong></p>
        <p style="margin: 5px 0 0 0;">You'll receive an invite to the ${tier} Telegram group at: ${sanitizeInput(telegramUsername)}</p>
      </div>
      `
          : ""
      }
      
      <p style="text-align: center; margin-top: 30px;">
        <a href="https://squaretrivia.com/boards" style="background-color: #0066FF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">View Available Boards</a>
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Payout sent template
   */
  getPayoutSentTemplate(data) {
    const { amount, method, transactionId, payoutType, fee } = data;

    const isInstant = payoutType === "instant";
    const headerColor = isInstant ? "#f59e0b" : "#10b981";
    const headerText = isInstant
      ? "⚡ Your Instant Payout Has Been Sent! ⚡"
      : "💰 Your Prize Has Been Sent! 💰";

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: ${headerColor}; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px; }
    .amount { font-size: 36px; color: ${headerColor}; font-weight: bold; text-align: center; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${headerText}</h2>
    </div>
    <div class="content">
      <p style="font-size: 18px; text-align: center;">Great news! Your prize payment has been processed.</p>
      
      <div class="amount">$${amount.toFixed(2)}</div>
      
      <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Payment Details:</h3>
        <p><strong>Method:</strong> ${method}</p>
        <p><strong>Transaction ID:</strong> ${transactionId}</p>
        <p><strong>Payout Type:</strong> ${isInstant ? "Instant (Same Day)" : "Standard Batch"}</p>
        ${isInstant && fee ? `<p><strong>Instant Fee:</strong> $${fee.toFixed(2)}</p>` : ""}
        <p><strong>Status:</strong> Completed ✅</p>
      </div>
      
      <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;"><strong>When will I receive it?</strong></p>
        <ul style="margin: 10px 0 0 20px;">
          ${isInstant ? "<li>Instant payouts arrive within minutes</li>" : ""}
          <li>PayPal/Venmo: Within minutes</li>
          <li>Zelle: 1-2 business days</li>
          <li>ACH/Bank: 2-3 business days</li>
          <li>Check: 5-7 business days</li>
        </ul>
      </div>
      
      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        Tax Note: If your total winnings exceed $600 this year, you'll receive a 1099 form for tax purposes.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Welcome template
   */
  getWelcomeTemplate(data) {
    const { email } = data;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066FF; color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Square Trivia! 🎮</h1>
    </div>
    <div class="content">
      <p style="font-size: 18px;">Hi there!</p>
      <p>Welcome to Square Trivia - where your sports knowledge pays off!</p>
      
      <h3>Getting Started:</h3>
      <ol>
        <li><strong>Make a donation</strong> to support our platform and gain access to a tier</li>
        <li><strong>Join the Telegram group</strong> for your tier to stay connected</li>
        <li><strong>Answer trivia questions</strong> correctly to earn squares</li>
        <li><strong>Win prizes</strong> when your squares match game outcomes!</li>
      </ol>
      
      <p style="text-align: center; margin: 30px 0;">
        <a href="https://squaretrivia.com/donate" style="background-color: #0066FF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">Get Started</a>
      </p>
      
      <p style="color: #666; font-size: 14px;">
        This is a skill-based competition. Success depends on your trivia knowledge!<br>
        Free entry options are available - see our website for details.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Instant payout confirmation template
   */
  getInstantPayoutConfirmationTemplate(data) {
    const { amount, fee, netAmount, transactionId } = data;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #10b981; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px; }
    .amount { font-size: 36px; color: #10b981; font-weight: bold; text-align: center; margin: 20px 0; }
    .instant-badge {
      display: inline-block;
      background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: bold;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>⚡ Your Instant Payout is on the way! ⚡</h2>
    </div>
    <div class="content">
      <div style="text-align: center;">
        <div class="instant-badge">INSTANT PAYOUT</div>
      </div>
      
      <p style="font-size: 18px; text-align: center;">Your prize has been sent via Stripe Instant Payout!</p>
      
      <div class="amount">$${netAmount.toFixed(2)}</div>
      
      <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Payment Details:</h3>
        <p><strong>Original Prize:</strong> $${amount.toFixed(2)}</p>
        <p><strong>Instant Fee (8%):</strong> -$${fee.toFixed(2)}</p>
        <p><strong>You Receive:</strong> $${netAmount.toFixed(2)}</p>
        <p><strong>Transaction ID:</strong> ${transactionId}</p>
        <p><strong>Status:</strong> Completed ✅</p>
      </div>
      
      <div style="background-color: #ecfdf5; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #10b981;">
        <p style="margin: 0;"><strong>⚡ Lightning Fast!</strong></p>
        <p style="margin: 10px 0 0 0;">Your funds should arrive within minutes to your connected bank account or debit card.</p>
      </div>
      
      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        Tax Note: If your total winnings exceed $600 this year, you'll receive a 1099 form for tax purposes.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Batch payout queued template
   */
  getBatchPayoutQueuedTemplate(data) {
    const { amount, expectedDate } = data;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066FF; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px; }
    .amount { font-size: 36px; color: #0066FF; font-weight: bold; text-align: center; margin: 20px 0; }
    .batch-badge {
      display: inline-block;
      background-color: #0066FF;
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: bold;
      margin: 10px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>📅 Your Prize is Scheduled! 📅</h2>
    </div>
    <div class="content">
      <div style="text-align: center;">
        <div class="batch-badge">STANDARD PAYOUT</div>
      </div>
      
      <p style="font-size: 18px; text-align: center;">Your prize has been queued for batch processing!</p>
      
      <div class="amount">$${amount.toFixed(2)}</div>
      <p style="text-align: center; color: #10b981; font-weight: bold; font-size: 18px;">
        Full amount - no fees! 🎉
      </p>
      
      <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Payout Schedule:</h3>
        <p><strong>Expected Payment Date:</strong> ${expectedDate}</p>
        <p><strong>Amount:</strong> $${amount.toFixed(2)}</p>
        <p><strong>Processing Fee:</strong> $0.00</p>
        <p><strong>Status:</strong> Queued for Processing 📋</p>
      </div>
      
      <div style="background-color: #e0f2fe; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #0066FF;">
        <p style="margin: 0;"><strong>💰 Maximum Value!</strong></p>
        <p style="margin: 10px 0 0 0;">By choosing standard payout, you receive 100% of your prize with no processing fees.</p>
      </div>
      
      <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Our Batch Schedule:</strong></p>
        <ul style="margin: 10px 0 0 20px;">
          <li><strong>Tuesday:</strong> Process Friday-Monday winners</li>
          <li><strong>Friday:</strong> Process Tuesday-Thursday winners</li>
        </ul>
        <p style="margin: 10px 0 0 0;">Funds typically arrive 1-2 business days after processing.</p>
      </div>
      
      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        We'll send another email when your payment is processed. Tax forms will be provided if your total winnings exceed $600 this year.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Payout choice reminder template
   */
  getPayoutChoiceReminderTemplate(data) {
    const { prizeAmount, winnerId, payoutChoiceToken } = data;

    // Calculate instant payout option
    const instantPayoutFee = prizeAmount * 0.08;
    const instantPayoutAmount = prizeAmount - instantPayoutFee;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f59e0b; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px; }
    .reminder-box {
      background-color: #fff7ed;
      border: 2px solid #f59e0b;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      text-align: center;
    }
    .button-urgent {
      display: inline-block;
      background-color: #f59e0b;
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>⏰ Don't Forget Your Prize Money! ⏰</h2>
    </div>
    <div class="content">
      <div class="reminder-box">
        <h3 style="margin-top: 0; color: #ea580c;">You still need to choose your payout method!</h3>
        <p style="font-size: 24px; font-weight: bold; color: #0066FF; margin: 20px 0;">
          $${prizeAmount.toFixed(2)} is waiting for you!
        </p>
      </div>
      
      <p style="font-size: 16px; text-align: center;">
        You won on Square Trivia, but haven't selected how you'd like to receive your prize money.
      </p>
      
      <div style="background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">Your Options:</h3>
        
        <div style="margin: 15px 0; padding: 15px; background-color: #fef3c7; border-radius: 8px;">
          <strong>⚡ Instant Payout:</strong> Get $${instantPayoutAmount.toFixed(2)} today!
          <br><span style="font-size: 14px; color: #666;">(8% fee = $${instantPayoutFee.toFixed(2)})</span>
        </div>
        
        <div style="margin: 15px 0; padding: 15px; background-color: #dcfce7; border-radius: 8px;">
          <strong>📅 Standard Payout:</strong> Get the full $${prizeAmount.toFixed(2)}
          <br><span style="font-size: 14px; color: #666;">(No fees, arrives in 2-3 days)</span>
        </div>
      </div>
      
      <div style="text-align: center;">
        <a href="https://squaretrivia.com/winners/payout-choice/${winnerId}?token=${payoutChoiceToken || ""}" class="button-urgent">
          Choose Payout Method Now
        </a>
      </div>
      
      <p style="color: #dc2626; text-align: center; font-weight: bold; margin-top: 30px;">
        Please choose within 72 hours to avoid delays in receiving your prize.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }
}

// Create singleton instance
const emailService = new EmailService();

// =====================================
// TELEGRAM SERVICE
// =====================================

class TelegramService {
  constructor() {
    this.bot = null;
    this.initialized = false;
  }

  /**
   * Initialize Telegram bot
   */
  initialize() {
    if (this.initialized) return;

    try {
      this.bot = new TelegramBot(functions.config().telegram.bot_token, {
        polling: false, // We're not receiving messages, only sending
      });

      this.initialized = true;
      console.log("Telegram service initialized");
    } catch (error) {
      logError(error, { context: "TelegramService.initialize" });
      throw new Error("Failed to initialize Telegram service");
    }
  }

  /**
   * Send Telegram message with retry
   */
  async sendMessage(chatId, message, options = {}) {
    if (!this.initialized) {
      this.initialize();
    }

    const defaultOptions = {
      parse_mode: NOTIFICATION_CONFIG.TELEGRAM.PARSE_MODE,
      ...options,
    };

    return await retryOperation(
      async () => {
        const result = await this.bot.sendMessage(
          chatId,
          message,
          defaultOptions
        );
        console.log(`Telegram message sent to ${chatId}`);
        return result;
      },
      3,
      2000
    );
  }

  /**
   * Send winner notification to user - ENHANCED WITH TIMING REVEAL
   */
  async sendWinnerDM(username, data) {
    if (!username) return null;

    const {
      game,
      quarter,
      score,
      position,
      prizeAmount,
      tier,
      tierId,
      winnerId,
      payoutChoiceToken,
      winnerTime,
      loserTime,
      hasLoser,
    } = data;

    // Calculate instant payout option
    const instantPayoutFee = prizeAmount * 0.08;
    const instantPayoutAmount = prizeAmount - instantPayoutFee;

    let message = `
🎉 *WINNER ALERT!* 🎉

*${quarter} Winner*
Game: ${this.escapeMarkdown(game)}
Score: ${score}
Your Square: #${position}

*Prize: $${prizeAmount.toFixed(2)}*
Tier: ${tier}
`;

    // Enhanced skill victory message with timing reveal
    if (hasLoser) {
      message += `
⚡ *TIMES REVEALED!* ⚡
_The moment you've been waiting for..._

Your Time: *${winnerTime}s* ✅
Opponent: *${loserTime}s* ❌

🏆 *You won by ${(loserTime - winnerTime).toFixed(1)} seconds!*
`;
    } else {
      message += `
🎯 *Solo Square Winner!*
Your Time: ${winnerTime}s
No competition needed!
`;
    }

    message += `
💸 *Choose Your Payout:*
⚡ *Instant:* $${instantPayoutAmount.toFixed(2)} today (8% fee)
📅 *Standard:* $${prizeAmount.toFixed(2)} in 2-3 days (no fee)

Visit: squaretrivia.com/winners/payout-choice/${winnerId}?token=${payoutChoiceToken}

Congratulations! 🏆
    `.trim();

    try {
      // Try to send using username (user must have started conversation with bot)
      await this.sendMessage(username, message);
      return { success: true };
    } catch (error) {
      console.log(
        `Cannot DM ${username} - user needs to start conversation with bot`
      );
      return {
        success: false,
        error: "User has not started conversation with bot",
      };
    }
  }

  /**
   * Send consolation notification - ENHANCED WITH CLOSE CALL MESSAGE
   */
  async sendConsolationDM(username, data) {
    if (!username) return null;

    const { game, winnerTime, loserTime, nextBoardId } = data;

    const message = `
🎁 *So Close! Consolation Prize* 🎁

_The times have been revealed..._

⏱️ *Speed Results:*
Winner: *${winnerTime}s* 🏆
Your Time: *${loserTime}s*

😱 Just *${(loserTime - winnerTime).toFixed(1)}s* away from victory!

*But you're not empty-handed!*
You've earned a *FREE SQUARE* for:
${this.escapeMarkdown(game.teams.away)} @ ${this.escapeMarkdown(game.teams.home)}

✅ No trivia required
✅ Choose any position
✅ Valid for 30 days

Visit: squaretrivia.com/boards/${nextBoardId}

_Note: Consolation squares cannot earn additional free squares._
    `.trim();

    try {
      await this.sendMessage(username, message);
      return { success: true };
    } catch (error) {
      console.log(`Cannot DM ${username} for consolation prize`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Post to tier group - ENHANCED WITH TIMING EXCITEMENT
   */
  async postToTierGroup(tierId, data) {
    const tier = getTierById(tierId);
    if (!tier) return null;

    const groupId = functions.config().telegram[tier.telegramGroupKey];
    if (!groupId) {
      console.warn(`No Telegram group configured for ${tierId}`);
      return null;
    }

    const {
      username,
      game,
      quarter,
      score,
      position,
      prizeAmount,
      winnerTime,
      hasLoser,
    } = data;

    const message = `
🏆 *WINNER in the ${tier.label}!*

${quarter}: ${this.escapeMarkdown(game)}
Score: ${score}
Winning Square: #${position}
⚡ Answer Time: *${winnerTime}s*
${hasLoser ? "_Won by speed in head-to-head!_" : "_Solo square winner!_"}

Congratulations to ${username ? "@" + username.replace("@", "") : "a lucky player"}!
Prize: $${prizeAmount.toFixed(2)} 💰
    `.trim();

    try {
      await this.sendMessage(groupId, message);
      return { success: true };
    } catch (error) {
      logError(error, {
        context: "postToTierGroup",
        tierId,
        groupId,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send admin alert
   */
  async sendAdminAlert(message) {
    const adminChatId = functions.config().telegram.admin_chat_id;
    if (!adminChatId) {
      console.warn("No admin chat ID configured");
      return null;
    }

    const formattedMessage = `
🚨 *ADMIN ALERT* 🚨

${message}

Time: ${new Date().toISOString()}
    `.trim();

    try {
      await this.sendMessage(adminChatId, formattedMessage);
      return { success: true };
    } catch (error) {
      logError(error, { context: "sendAdminAlert" });
      return { success: false, error: error.message };
    }
  }

  /**
   * Escape markdown special characters
   */
  escapeMarkdown(text) {
    if (!text) return "";
    return text.replace(/[*_`\[\]()]/g, "\\$&");
  }
}

// Create singleton instance
const telegramService = new TelegramService();

// =====================================
// SMS SERVICE (TWILIO)
// =====================================

class SMSService {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.enabled = NOTIFICATION_CONFIG.SMS.ENABLED;
  }

  /**
   * Initialize Twilio client
   */
  initialize() {
    if (this.initialized || !this.enabled) return;

    try {
      this.client = twilio(
        functions.config().twilio.account_sid,
        functions.config().twilio.auth_token
      );

      this.initialized = true;
      console.log("SMS service initialized");
    } catch (error) {
      console.warn("SMS service not configured:", error.message);
      this.enabled = false;
    }
  }

  /**
   * Send SMS with retry
   */
  async sendSMS(to, message) {
    if (!this.enabled) return null;

    if (!this.initialized) {
      this.initialize();
    }

    // Truncate message if too long
    const truncatedMessage =
      message.length > NOTIFICATION_CONFIG.SMS.MAX_LENGTH
        ? message.substring(0, NOTIFICATION_CONFIG.SMS.MAX_LENGTH - 3) + "..."
        : message;

    return await retryOperation(
      async () => {
        const result = await this.client.messages.create({
          body: truncatedMessage,
          from: functions.config().twilio.phone_number,
          to,
        });
        console.log(`SMS sent to ${to}: ${result.sid}`);
        return result;
      },
      2,
      3000
    );
  }

  /**
   * Send winner SMS - ENHANCED WITH TIMING EXCITEMENT
   */
  async sendWinnerSMS(phone, data) {
    if (!phone || !this.enabled) return null;

    const { game, prizeAmount, winnerTime, hasLoser } = data;

    const skillInfo = hasLoser
      ? ` Times revealed: ${winnerTime}s (fastest!)`
      : "";
    const message = `🎉 Square Trivia: You won $${prizeAmount.toFixed(2)} on ${game}!${skillInfo} Choose instant payout (8% fee) or standard (no fee). Check your email for details.`;

    try {
      await this.sendSMS(phone, message);
      return { success: true };
    } catch (error) {
      logError(error, { context: "sendWinnerSMS" });
      return { success: false, error: error.message };
    }
  }

  /**
   * Send consolation SMS - ENHANCED WITH CLOSE CALL MESSAGE
   */
  async sendConsolationSMS(phone, data) {
    if (!phone || !this.enabled) return null;

    const { game, loserTime, winnerTime } = data;
    const diff = (loserTime - winnerTime).toFixed(1);

    const message = `🎁 Square Trivia: So close! You were just ${diff}s slower. You earned a FREE SQUARE for ${game.teams.away} @ ${game.teams.home}! Check email for details.`;

    try {
      await this.sendSMS(phone, message);
      return { success: true };
    } catch (error) {
      logError(error, { context: "sendConsolationSMS" });
      return { success: false, error: error.message };
    }
  }
}

// Create singleton instance
const smsService = new SMSService();

// =====================================
// NOTIFICATION QUEUE PROCESSOR
// =====================================

/**
 * Process notification queue (runs every minute)
 */
exports.processNotificationQueue = functions.pubsub
  .schedule("every 1 minutes")
  .onRun(async (context) => {
    const db = admin.firestore();

    try {
      // Get pending notifications
      const pendingNotifications = await db
        .collection("notificationQueue")
        .where("status", "==", "pending")
        .where("attempts", "<", 3)
        .orderBy("priority", "desc")
        .orderBy("createdAt", "asc")
        .limit(20)
        .get();

      if (pendingNotifications.empty) {
        return;
      }

      console.log(`Processing ${pendingNotifications.size} notifications`);

      // Process each notification
      const promises = pendingNotifications.docs.map((doc) =>
        processNotification(db, doc).catch((error) => {
          logError(error, {
            context: "processNotification",
            notificationId: doc.id,
          });
          return null;
        })
      );

      await Promise.all(promises);
    } catch (error) {
      logError(error, { context: "processNotificationQueue" });
    }
  });

/**
 * Process a single notification
 */
async function processNotification(db, notificationDoc) {
  const notification = notificationDoc.data();

  // Update status to processing
  await notificationDoc.ref.update({
    status: "processing",
    processingAt: getTimestamp(),
    attempts: admin.firestore.FieldValue.increment(1),
  });

  try {
    let result;

    switch (notification.type) {
      case "winner":
        result = await sendWinnerNotification(db, notification.winnerId);
        break;
      case "consolation":
        result = await sendConsolationNotification(
          db,
          notification.userId,
          notification.data
        );
        break;
      case "square_assigned":
        result = await sendSquareAssignedNotification(db, notification.claimId);
        break;
      case "donation_confirm":
        result = await sendDonationConfirmation(db, notification.donationId);
        break;
      case "payout_sent":
        result = await sendPayoutNotification(db, notification.payoutId);
        break;
      case "instant_payout_confirmation":
        result = await sendInstantPayoutConfirmation(
          db,
          notification.winnerId,
          notification.payoutData
        );
        break;
      case "batch_payout_queued":
        result = await sendBatchPayoutQueued(
          db,
          notification.winnerId,
          notification.payoutData
        );
        break;
      case "payout_choice_reminder":
        result = await sendPayoutChoiceReminder(db, notification);
        break;
      default:
        throw new Error(`Unknown notification type: ${notification.type}`);
    }

    // Mark as completed
    await notificationDoc.ref.update({
      status: "completed",
      completedAt: getTimestamp(),
      result,
    });

    return result;
  } catch (error) {
    // Mark as failed
    const isFinal = notification.attempts >= 2;

    await notificationDoc.ref.update({
      status: isFinal ? "failed" : "pending",
      lastError: error.message,
      nextRetryAt: isFinal ? null : new Date(Date.now() + 5 * 60 * 1000), // 5 min
    });

    throw error;
  }
}

// =====================================
// NOTIFICATION SENDERS
// =====================================

/**
 * Send winner notification - ENHANCED WITH TIMING REVEAL SUBJECTS
 * Note: Prize amounts are already calculated using tier-specific percentages (77% or 80%)
 * by the winner processing system before being passed to this notification system
 */
async function sendWinnerNotification(db, winnerId) {
  // Get winner details
  const winnerDoc = await db.collection("winners").doc(winnerId).get();
  if (!winnerDoc.exists) {
    throw new Error("Winner not found");
  }

  const winner = winnerDoc.data();

  // Get user details
  const userDoc = await db.collection("users").doc(winner.userId).get();
  if (!userDoc.exists) {
    throw new Error("User not found");
  }

  const user = userDoc.data();
  const tier = getTierById(winner.tierId);

  // Generate secure token for payout choice
  const payoutChoiceToken = generateSecureToken();

  const notificationData = {
    game: winner.gameInfo
      ? `${winner.gameInfo.teams.away} @ ${winner.gameInfo.teams.home}`
      : "Unknown Game",
    quarter: GAME_CONFIG.QUARTERS[winner.quarter]?.label || winner.quarter,
    score: winner.score,
    position: winner.position,
    prizeAmount: winner.prizeAmount,
    tier: tier?.label || winner.tierId,
    tierId: winner.tierId,
    username: user.telegramUsername,
    winnerId: winnerId,
    payoutChoiceToken: payoutChoiceToken,
    // Skill-based fields
    winnerTime:
      winner.winnerAnswerTimeSeconds || winner.winnerAnswerTimeMs / 1000,
    loserTime: winner.loserAnswerTimeMs
      ? winner.loserAnswerTimeMs / 1000
      : null,
    hasLoser: !!winner.loserUserId,
  };

  const results = {
    email: null,
    telegram: null,
    sms: null,
    group: null,
  };

  // Check if user has Telegram
  const hasTelegram = user.hasTelegram || !!user.telegramUsername;

  // Send email with enhanced subject line
  if (user.email && user.notifications?.email !== false) {
    try {
      // Use enhanced template for non-Telegram users
      const template = hasTelegram ? "winner" : "winner_enhanced";
      const subject = notificationData.hasLoser
        ? `🎉 You Won! Times Revealed - $${winner.prizeAmount.toFixed(2)} Prize!`
        : `🎉 You Won $${winner.prizeAmount.toFixed(2)} on Square Trivia!`;

      await emailService.sendEmail(
        user.email,
        subject,
        emailService.getTemplate(template, notificationData)
      );
      results.email = { success: true };
    } catch (error) {
      results.email = { success: false, error: error.message };
    }
  }

  // Send Telegram DM only if user has Telegram
  if (
    hasTelegram &&
    user.telegramUsername &&
    user.notifications?.telegram !== false
  ) {
    results.telegram = await telegramService.sendWinnerDM(
      user.telegramUsername,
      notificationData
    );

    // Post to tier group only if user has Telegram
    results.group = await telegramService.postToTierGroup(
      winner.tierId,
      notificationData
    );
  }

  // Send SMS
  if (user.phone && user.notifications?.sms !== false) {
    results.sms = await smsService.sendWinnerSMS(user.phone, notificationData);
  }

  // Update winner record
  await winnerDoc.ref.update({
    notificationStatus: "sent",
    notifiedAt: getTimestamp(),
    notificationResults: results,
    payoutChoicePending: true, // Track that payout choice is pending
    payoutChoiceToken: payoutChoiceToken, // Save security token
    payoutChoiceUrl: `https://squaretrivia.com/winners/payout-choice/${winnerId}?token=${payoutChoiceToken}`,
  });

  return results;
}

/**
 * Send consolation notification - ENHANCED WITH CLOSE CALL SUBJECT
 */
async function sendConsolationNotification(db, userId, data) {
  const { nextBoardId, winnerTime, loserTime, game } = data;

  // Get user details
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) {
    throw new Error("User not found");
  }

  const user = userDoc.data();

  const notificationData = {
    userId,
    nextBoardId,
    game,
    winnerTime,
    loserTime,
  };

  const results = {
    email: null,
    telegram: null,
    sms: null,
  };

  // Send email with enhanced subject
  if (user.email && user.notifications?.email !== false) {
    try {
      await emailService.sendEmail(
        user.email,
        "🎁 So Close! You Earned a Free Square!",
        emailService.getTemplate("consolation_prize", notificationData)
      );
      results.email = { success: true };
    } catch (error) {
      results.email = { success: false, error: error.message };
    }
  }

  // Send Telegram if available
  if (user.telegramUsername && user.notifications?.telegram !== false) {
    results.telegram = await telegramService.sendConsolationDM(
      user.telegramUsername,
      notificationData
    );
  }

  // Send SMS if available
  if (user.phone && user.notifications?.sms !== false) {
    results.sms = await smsService.sendConsolationSMS(
      user.phone,
      notificationData
    );
  }

  return results;
}

/**
 * Send square assigned notification
 */
async function sendSquareAssignedNotification(db, claimId) {
  const claimDoc = await db.collection("squareClaims").doc(claimId).get();
  if (!claimDoc.exists) {
    throw new Error("Claim not found");
  }

  const claim = claimDoc.data();

  // Get user and board details
  const [userDoc, boardDoc] = await Promise.all([
    db.collection("users").doc(claim.userId).get(),
    db.collection("boards").doc(claim.boardId).get(),
  ]);

  const user = userDoc.data();
  const board = boardDoc.data();

  const notificationData = {
    game: board.gameInfo
      ? `${board.gameInfo.teams.away} @ ${board.gameInfo.teams.home}`
      : "Unknown Game",
    position: claim.position,
    boardId: claim.boardId,
  };

  // Send email only
  if (user.email && user.notifications?.email !== false) {
    await emailService.sendEmail(
      user.email,
      `Square #${claim.position} Assigned - ${notificationData.game}`,
      emailService.getTemplate("square_assigned", notificationData)
    );
  }

  return { email: { success: true } };
}

/**
 * Send donation confirmation
 */
async function sendDonationConfirmation(db, donationId) {
  const donationDoc = await db.collection("donations").doc(donationId).get();
  if (!donationDoc.exists) {
    throw new Error("Donation not found");
  }

  const donation = donationDoc.data();
  const tier = getTierById(donation.tierId);

  const notificationData = {
    amount: donation.amount,
    tier: tier?.label || donation.tierId,
    telegramUsername: donation.telegramUsername,
  };

  // Get user email
  const userDoc = await db.collection("users").doc(donation.userId).get();
  const user = userDoc.data();

  if (user.email) {
    await emailService.sendEmail(
      user.email,
      `Thank you for your $${donation.amount} donation to Square Trivia!`,
      emailService.getTemplate("donation_confirm", notificationData)
    );
  }

  return { email: { success: true } };
}

/**
 * Send payout notification
 */
async function sendPayoutNotification(db, payoutId) {
  const payoutDoc = await db.collection("payouts").doc(payoutId).get();
  if (!payoutDoc.exists) {
    throw new Error("Payout not found");
  }

  const payout = payoutDoc.data();

  const notificationData = {
    amount: payout.amount,
    method: payout.method,
    transactionId: payout.transactionId,
    payoutType: payout.payoutType,
    fee: payout.instantPayoutFee || 0,
  };

  // Get user email
  const userDoc = await db.collection("users").doc(payout.userId).get();
  const user = userDoc.data();

  if (user.email) {
    await emailService.sendEmail(
      user.email,
      `💰 Your $${payout.amount.toFixed(2)} prize has been sent!`,
      emailService.getTemplate("payout_sent", notificationData)
    );
  }

  // Also send SMS if available
  const smsResult = user.phone
    ? await smsService.sendSMS(
        user.phone,
        `Square Trivia: Your $${payout.amount.toFixed(2)} prize has been sent via ${payout.method}!`
      )
    : null;

  return {
    email: { success: true },
    sms: smsResult,
  };
}

/**
 * Send instant payout confirmation
 */
async function sendInstantPayoutConfirmation(db, winnerId, payoutData) {
  const { amount, fee, netAmount, transactionId, userId } = payoutData;

  // Get user email
  const userDoc = await db.collection("users").doc(userId).get();
  const user = userDoc.data();

  if (user.email) {
    await emailService.sendEmail(
      user.email,
      `⚡ Your $${netAmount.toFixed(2)} instant payout is on the way!`,
      emailService.getTemplate("instant_payout_confirmation", {
        amount,
        fee,
        netAmount,
        transactionId,
      })
    );
  }

  // Update winner record
  await db.collection("winners").doc(winnerId).update({
    payoutType: "instant",
    payoutChoiceMadeAt: getTimestamp(),
    instantPayoutFee: fee,
    instantPayoutNetAmount: netAmount,
  });

  return { email: { success: true } };
}

/**
 * Send batch payout queued notification
 */
async function sendBatchPayoutQueued(db, winnerId, payoutData) {
  const { amount, expectedDate, userId } = payoutData;

  // Get user email
  const userDoc = await db.collection("users").doc(userId).get();
  const user = userDoc.data();

  if (user.email) {
    await emailService.sendEmail(
      user.email,
      `📅 Your $${amount.toFixed(2)} prize is scheduled for ${expectedDate}`,
      emailService.getTemplate("batch_payout_queued", {
        amount,
        expectedDate,
      })
    );
  }

  // Update winner record
  await db.collection("winners").doc(winnerId).update({
    payoutType: "batch",
    payoutChoiceMadeAt: getTimestamp(),
    expectedPayoutDate: expectedDate,
  });

  return { email: { success: true } };
}

/**
 * Send payout choice reminder
 */
async function sendPayoutChoiceReminder(db, notification) {
  const { winnerId, prizeAmount, email, payoutChoiceToken } = notification;

  if (email) {
    await emailService.sendEmail(
      email,
      `⏰ Reminder: Choose how to receive your $${prizeAmount.toFixed(2)} prize!`,
      emailService.getTemplate("payout_choice_reminder", {
        prizeAmount,
        winnerId,
        payoutChoiceToken,
      })
    );
  }

  // Update reminder sent timestamp
  await db.collection("winners").doc(winnerId).update({
    lastPayoutReminderSent: getTimestamp(),
  });

  return { email: { success: true } };
}

// =====================================
// ADMIN NOTIFICATIONS
// =====================================

/**
 * Send admin alert for critical issues
 */
exports.sendAdminAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw createError("permission", ERROR_MESSAGES.ADMIN_ONLY);
  }

  const { message, type, details } = data;

  const fullMessage = `
Alert Type: ${type}
Message: ${message}
${details ? `Details: ${JSON.stringify(details, null, 2)}` : ""}
  `.trim();

  // Send via all channels
  const results = {
    email: null,
    telegram: null,
  };

  // Email admin
  try {
    await emailService.sendEmail(
      NOTIFICATION_CONFIG.EMAIL.ADMIN_ADDRESS,
      `🚨 Square Trivia Admin Alert: ${type}`,
      `<pre>${fullMessage}</pre>`
    );
    results.email = { success: true };
  } catch (error) {
    results.email = { success: false, error: error.message };
  }

  // Telegram admin
  results.telegram = await telegramService.sendAdminAlert(fullMessage);

  return results;
});

// =====================================
// RETRY FAILED NOTIFICATIONS
// =====================================

/**
 * Retry failed notifications
 */
exports.retryFailedNotifications = functions.https.onCall(
  async (data, context) => {
    if (!context.auth?.token?.admin) {
      throw createError("permission", ERROR_MESSAGES.ADMIN_ONLY);
    }

    const { notificationId } = data;
    const db = admin.firestore();

    if (notificationId) {
      // Retry specific notification
      const notificationRef = db
        .collection("notificationQueue")
        .doc(notificationId);
      await notificationRef.update({
        status: "pending",
        attempts: 0,
        retryRequestedBy: context.auth.uid,
        retryRequestedAt: getTimestamp(),
      });

      return { retriedCount: 1 };
    } else {
      // Retry all failed notifications
      const failed = await db
        .collection("notificationQueue")
        .where("status", "==", "failed")
        .get();

      const batch = db.batch();

      failed.forEach((doc) => {
        batch.update(doc.ref, {
          status: "pending",
          attempts: 0,
          retryRequestedBy: context.auth.uid,
          retryRequestedAt: getTimestamp(),
        });
      });

      await batch.commit();

      return { retriedCount: failed.size };
    }
  }
);

// =====================================
// WELCOME NEW USERS
// =====================================

/**
 * Send welcome email to new users
 */
exports.sendWelcomeEmail = functions.auth.user().onCreate(async (user) => {
  if (!user.email) return;

  try {
    await emailService.sendEmail(
      user.email,
      "Welcome to Square Trivia! 🎮",
      emailService.getTemplate("welcome", { email: user.email })
    );

    console.log(`Welcome email sent to ${user.email}`);
  } catch (error) {
    logError(error, {
      context: "sendWelcomeEmail",
      userId: user.uid,
    });
  }
});

// =====================================
// PAYOUT CHOICE SYSTEM
// =====================================

/**
 * Send payout choice reminder scheduler
 */
exports.sendPayoutChoiceReminder = functions.pubsub
  .schedule("every 12 hours")
  .onRun(async (context) => {
    const db = admin.firestore();

    try {
      // Get winners who haven't chosen payout method after 24 hours
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - 24);

      const pendingWinners = await db
        .collection("winners")
        .where("payoutChoicePending", "==", true)
        .where("notifiedAt", "<", cutoffTime)
        .limit(50)
        .get();

      if (pendingWinners.empty) {
        return;
      }

      console.log(
        `Sending payout choice reminders to ${pendingWinners.size} winners`
      );

      const promises = pendingWinners.docs.map(async (doc) => {
        const winner = doc.data();
        const userDoc = await db.collection("users").doc(winner.userId).get();

        if (userDoc.exists) {
          const user = userDoc.data();

          // Queue reminder notification
          await db.collection("notificationQueue").add({
            type: "payout_choice_reminder",
            winnerId: doc.id,
            userId: winner.userId,
            prizeAmount: winner.prizeAmount,
            email: user.email,
            payoutChoiceToken: winner.payoutChoiceToken,
            priority: 5,
            createdAt: getTimestamp(),
            status: "pending",
            attempts: 0,
          });
        }
      });

      await Promise.all(promises);
    } catch (error) {
      logError(error, { context: "sendPayoutChoiceReminder" });
    }
  });

// =====================================
// PAYOUT CHOICE HANDLERS
// =====================================

/**
 * Record user's payout choice
 */
exports.recordPayoutChoice = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw createError(
      "unauthenticated",
      "Must be logged in to choose payout method"
    );
  }

  const { winnerId, payoutType } = data;
  const db = admin.firestore();

  // Validate payout type
  if (!["instant", "batch"].includes(payoutType)) {
    throw createError("invalid-argument", "Invalid payout type");
  }

  try {
    // Get winner record
    const winnerRef = db.collection("winners").doc(winnerId);
    const winnerDoc = await winnerRef.get();

    if (!winnerDoc.exists) {
      throw createError("not-found", "Winner record not found");
    }

    const winner = winnerDoc.data();

    // Verify user owns this win
    if (winner.userId !== context.auth.uid) {
      throw createError(
        "permission-denied",
        "Cannot choose payout for another user"
      );
    }

    // Check if choice already made
    if (winner.payoutChoiceMadeAt) {
      throw createError("already-exists", "Payout choice already made");
    }

    // Calculate amounts based on choice
    let updateData = {
      payoutType,
      payoutChoiceMadeAt: getTimestamp(),
      payoutChoicePending: false,
    };

    if (payoutType === "instant") {
      const instantCalc = calculateInstantPayout(winner.prizeAmount);
      updateData = {
        ...updateData,
        instantPayoutFee: instantCalc.fee,
        instantPayoutNetAmount: instantCalc.netAmount,
        status: "instant",
      };

      // Trigger instant payout processing
      await db.collection("payoutQueue").add({
        type: "instant",
        winnerId,
        userId: winner.userId,
        amount: instantCalc.netAmount,
        fee: instantCalc.fee,
        originalAmount: winner.prizeAmount,
        createdAt: getTimestamp(),
        status: "pending",
      });
    } else {
      // Batch payout
      const nextBatchDate = getNextBatchPayoutDate();
      updateData = {
        ...updateData,
        expectedPayoutDate: nextBatchDate,
        status: "queued_for_batch",
      };

      // Add to batch queue
      await db.collection("batchPayoutQueue").add({
        winnerId,
        userId: winner.userId,
        amount: winner.prizeAmount,
        expectedDate: nextBatchDate,
        createdAt: getTimestamp(),
        status: "pending",
      });
    }

    // Update winner record
    await winnerRef.update(updateData);

    // Track analytics
    await trackPayoutChoice(
      db,
      winnerId,
      payoutType,
      winner.prizeAmount,
      winner.tierId
    );

    // Send confirmation notification
    await db.collection("notificationQueue").add({
      type:
        payoutType === "instant"
          ? "instant_payout_confirmation"
          : "batch_payout_queued",
      winnerId,
      payoutData: {
        amount: winner.prizeAmount,
        fee: updateData.instantPayoutFee || 0,
        netAmount: updateData.instantPayoutNetAmount || winner.prizeAmount,
        expectedDate: updateData.expectedPayoutDate || null,
        userId: winner.userId,
      },
      priority: 10,
      createdAt: getTimestamp(),
      status: "pending",
      attempts: 0,
    });

    return {
      success: true,
      payoutType,
      details:
        payoutType === "instant"
          ? calculateInstantPayout(winner.prizeAmount)
          : { amount: winner.prizeAmount, expectedDate: nextBatchDate },
    };
  } catch (error) {
    logError(error, {
      context: "recordPayoutChoice",
      winnerId,
      payoutType,
      userId: context.auth.uid,
    });
    throw error;
  }
});

/**
 * Process payout choice from email link
 */
exports.processPayoutChoice = functions.https.onRequest(async (req, res) => {
  const { winnerId, choice, token } = req.query;

  if (!winnerId || !choice || !token) {
    return res.status(400).send("Missing required parameters");
  }

  const db = admin.firestore();

  try {
    // Get winner record
    const winnerDoc = await db.collection("winners").doc(winnerId).get();

    if (!winnerDoc.exists) {
      return res.status(404).send("Winner record not found");
    }

    const winner = winnerDoc.data();

    // Verify token
    if (winner.payoutChoiceToken !== token) {
      return res.status(403).send("Invalid or expired token");
    }

    if (winner.payoutChoiceMadeAt) {
      return res.redirect(
        `https://squaretrivia.com/payout-already-chosen?id=${winnerId}`
      );
    }

    // Process the choice
    await exports.recordPayoutChoice(
      {
        winnerId,
        payoutType: choice,
      },
      {
        auth: { uid: winner.userId },
      }
    );

    // Redirect to success page
    return res.redirect(
      `https://squaretrivia.com/payout-success?type=${choice}&id=${winnerId}`
    );
  } catch (error) {
    logError(error, {
      context: "processPayoutChoice",
      winnerId,
      choice,
    });
    return res.status(500).send("Error processing payout choice");
  }
});

// =====================================
// ANALYTICS & MONITORING
// =====================================

/**
 * Track payout choice analytics
 */
async function trackPayoutChoice(
  db,
  winnerId,
  payoutType,
  prizeAmount,
  tierId
) {
  try {
    await db.collection("payoutAnalytics").add({
      winnerId,
      payoutType,
      prizeAmount,
      tierId,
      instantPayoutFee:
        payoutType === "instant" ? prizeAmount * INSTANT_PAYOUT_FEE : 0,
      netAmount:
        payoutType === "instant"
          ? prizeAmount * (1 - INSTANT_PAYOUT_FEE)
          : prizeAmount,
      timestamp: getTimestamp(),
      date: new Date().toISOString().split("T")[0],
    });
  } catch (error) {
    logError(error, { context: "trackPayoutChoice", winnerId, payoutType });
  }
}

/**
 * Get payout choice statistics
 */
exports.getPayoutStats = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw createError("permission", ERROR_MESSAGES.ADMIN_ONLY);
  }

  const db = admin.firestore();
  const { startDate, endDate, tierId } = data;

  let query = db.collection("payoutAnalytics");

  if (startDate) {
    query = query.where("date", ">=", startDate);
  }
  if (endDate) {
    query = query.where("date", "<=", endDate);
  }
  if (tierId) {
    query = query.where("tierId", "==", tierId);
  }

  const snapshot = await query.get();

  const stats = {
    total: 0,
    instant: 0,
    batch: 0,
    totalFees: 0,
    avgInstantFee: 0,
    instantPercentage: 0,
    byTier: {},
  };

  snapshot.forEach((doc) => {
    const data = doc.data();
    stats.total++;

    if (data.payoutType === "instant") {
      stats.instant++;
      stats.totalFees += data.instantPayoutFee || 0;
    } else {
      stats.batch++;
    }

    // Track by tier
    if (!stats.byTier[data.tierId]) {
      stats.byTier[data.tierId] = {
        total: 0,
        instant: 0,
        batch: 0,
        totalFees: 0,
      };
    }

    stats.byTier[data.tierId].total++;
    if (data.payoutType === "instant") {
      stats.byTier[data.tierId].instant++;
      stats.byTier[data.tierId].totalFees += data.instantPayoutFee || 0;
    } else {
      stats.byTier[data.tierId].batch++;
    }
  });

  // Calculate percentages
  if (stats.total > 0) {
    stats.instantPercentage = (stats.instant / stats.total) * 100;
    stats.avgInstantFee =
      stats.instant > 0 ? stats.totalFees / stats.instant : 0;
  }

  return stats;
});

// =====================================
// EXPORTS
// =====================================

module.exports = {
  // Services
  emailService,
  telegramService,
  smsService,

  // Cloud Functions
  processNotificationQueue: exports.processNotificationQueue,
  sendAdminAlert: exports.sendAdminAlert,
  retryFailedNotifications: exports.retryFailedNotifications,
  sendWelcomeEmail: exports.sendWelcomeEmail,
  sendPayoutChoiceReminder: exports.sendPayoutChoiceReminder,
  recordPayoutChoice: exports.recordPayoutChoice,
  processPayoutChoice: exports.processPayoutChoice,
  getPayoutStats: exports.getPayoutStats,

  // Notification senders
  sendWinnerNotification,
  sendConsolationNotification,
  sendSquareAssignedNotification,
  sendDonationConfirmation,
  sendPayoutNotification,
  sendInstantPayoutConfirmation,
  sendBatchPayoutQueued,
  sendPayoutChoiceReminder,

  // Analytics
  trackPayoutChoice,

  // Helper functions
  calculateInstantPayout,
  getNextBatchPayoutDate,
  getPayoutPercentage,
  generateSecureToken,
};
