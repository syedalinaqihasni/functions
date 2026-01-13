const { logger } = require("firebase-functions");
const {
  getRandomCTA,
  fbPublish,
  igPublish,
  getHashtags,
  tgPublish,
} = require("./social-posts");

const tierAmounts = {
    tier_25: 200,
    tier_50: 450,
    tier_100: 900,
    tier_250: 2250,
    tier_500: 4500,
    tier_1000: 9000,
  };
const { TwitterApi } = require("twitter-api-v2");

require("dotenv").config();
const hashTags = getHashtags();
// Unified logging helper
function logInfo(context, data) {
  console.log(`🟢 [INFO] ${context}:`, data);
  logger.info(`[${context}]`, data);
}
function logError(context, error) {
  console.error(
    `🔴 [ERROR] ${context}:`,
    error.response?.data || error.message
  );
  logger.error(`[${context}]`, error.response?.data || error.message);
}
// ✅ Clean helper to extract file extensions safely from URLs
function getFileExt(url = "") {
  if (!url) return "";
  try {
    const cleanUrl = url.split("?")[0].split("#")[0];
    const ext = cleanUrl.split(".").pop().toLowerCase();
    return ext;
  } catch {
    return "";
  }
}

const client = new TwitterApi({
  appKey: process.env.X_CONSUMER_KEY || "8u3xjg84tAgJ14XaiiGwlM25A",
  appSecret:
    process.env.X_CONSUMER_SECRET ||
    "j3eGxuh8UfqWjzpHXa9DFhuV4Nvvat9EcU36E8WP4pDrJigOtq",
  accessToken:
    process.env.X_ACCESS_TOKEN ||
    "1978854431979339776-MNoZVnCwIG2HQhHN2SOXRoZJgFv6ed",
  accessSecret:
    process.env.X_ACCESS_TOKEN_SECRET ||
    "Rdbkm9moIhQhu6xreXZcEkHJDm1GGreKIrjRuJ5NaZ4TM",
});

// ✅ Export reusable function
async function postTweet(message) {
  try {
    const tweet = await client.v2.tweet(message);
    logger.info("✅ Tweet posted successfully:", tweet.data.id);
    return tweet;
  } catch (error) {
    logger.info("❌ Failed to post tweet:", error);
    throw error;
  }
}

async function postToAllPlatforms({ media, caption, link, tweet, facebook }) {
  const ext = media ? getFileExt(media) : null;

  try {
    const fbCaption = facebook || caption; // use facebook caption if provided, else default to caption

    if (ext && ["jpg", "jpeg", "png"].includes(ext)) {
      // 📸 Image post
      await fbPublish({ media, caption: fbCaption, type: "IMAGE" });
      await tgPublish({ media, caption, type: "IMAGE" });
      await igPublish({ media, caption, type: "IMAGE" });
      await postTweet(tweet || caption);
    } else if (ext === "mp4") {
      // 🎥 Video post
      await fbPublish({ media, caption: fbCaption, type: "VIDEO" });
      await tgPublish({ media, caption, type: "VIDEO" });
      await igPublish({ media, caption, type: "VIDEO" });
      await postTweet(tweet || caption);
    } else if (link) {
      // 🔗 Link post
      await fbPublish({ link, caption: fbCaption, type: "LINK" });
      await tgPublish({ caption: `${caption}\n\n${link}`, type: "LINK" });
      await postTweet(tweet || caption);
    } else if (!media && !link && caption) {
      // 📝 Text-only post
      await fbPublish({ caption: fbCaption, type: "TEXT" });
      await tgPublish({ caption, type: "TEXT" });
      await postTweet(tweet || caption);
    } else {
      throw new Error(
        `❌ Unsupported file type: .${ext || "unknown"}. Use JPG, PNG, or MP4.`
      );
    }

    logInfo("✅ All platform posts completed successfully", {
      media,
      caption,
      link,
    });
  } catch (error) {
    logError("❌ Error posting to all platforms", error.response?.data || error);
    throw error;
  }
}


// Builds post text with CTA + hashTags
function buildTemplate(body, cta) {
  return `${body.trim()}

${cta ? cta + "\n" : ""}${hashTags ? "\n" + hashTags : ""}`;
}

// Post Templates
//
// 1. Winner Announcements

// Trigger: Immediately after a game ends or a winner is declared.
// Big Win Template → When prize ≥ $100 or top-tier win.
// Standard Win → For normal wins (mid-tier, typical payouts).
// Photo Finish → When the win margin is less than 1 second between winner and runner-up.

// Big Win Post Generator
async function BigWinPost({
  winner,
  prize,
  time,
  team1,
  team2,
  square,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
🚨 ${winner} just took home $${prize} with a blazing ${(time / 1000).toFixed(2)}s answer! Think you're faster? 🏃‍♂️  

${team1} vs ${team2} - Square ${square}  
Speed Wins. Always.  
#SquareTrivia #SpeedWins
  `;

  const tweetBody = `
🚨 ${winner} won $${prize} in ${(time / 1000).toFixed(2)}s!  
Faster than that? 🏃‍♂️  
${team1} vs ${team2} — Square ${square}  
#SquareTrivia #SpeedWins
`;
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweetBody),
  });
}

// Standard Win Post Generator// Standard Win Post Generator with Random Templates
async function StandardWinPost({
  winner,
  prize,
  team1,
  team2,
  time,
  square,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });

  // Define multiple templates
  const templates = [
    // Win-1: Quick & Clean
    `🏆 WINNER: @${winner}

Square "${square}" = $${prize}
Time: ${(time / 1000).toFixed(2)} seconds
Game: ${team1} vs ${team2}

Speed Wins Always.`,

    // Win-2: Speed Focus
    `⚡ ${(time / 1000).toFixed(2)} SECONDS TO VICTORY

@${winner} takes Square "${square}"
Prize: $${prize}

Speed Wins Always.`,

    // Win-3: Prize Focus
    `💰 $${prize} WINNER

@${winner} dominated Square "${square}"
Winning time: ${(time / 1000).toFixed(2)}s

Speed Wins Always.`,

    // Win-4: Competition Angle
    `🔥 @${winner} WINS

Beat ${winner} others to Square "${square}"
Time: ${(time / 1000).toFixed(2)}s = $${prize}

Think you're faster?
Speed Wins Always.`,

    // Win-5: Celebration
    `🎊 VICTORY on Square "${square}"

@${winner}
Speed: ${(time / 1000).toFixed(2)} seconds
Payout: $${prize}

Your turn next.
Speed Wins Always.`,
    // orignal message
    `
BOOM! 💥 $${prize} win for ${winner} on the ${team1} vs ${team2} board!  
Answer time: ${(time / 1000).toFixed(2)} seconds ⚡  

Speed Wins. Always.
  `,
  ];

  const tweetTemplates = [
    // Win-1: Quick & Clean
    `🏆 WINNER: @${winner} — Square "${square}" | $${prize} 💰 | ${(time / 1000).toFixed(2)}s ⚡ | ${team1} vs ${team2} | Speed Wins Always.`,

    // Win-2: Speed Focus
    `⚡ ${(time / 1000).toFixed(2)}s TO VICTORY! @${winner} grabs Square "${square}" and wins $${prize}! Speed Wins Always.`,

    // Win-3: Prize Focus
    `💰 $${prize} WINNER! @${winner} crushed Square "${square}" in ${(time / 1000).toFixed(2)}s. Speed Wins Always.`,

    // Win-4: Competition Angle
    `🔥 @${winner} WINS Square "${square}" in ${(time / 1000).toFixed(2)}s — earning $${prize}! Think you’re faster? Speed Wins Always.`,

    // Win-5: Celebration
    `🎉 Victory on Square "${square}"! @${winner} blitzed it in ${(time / 1000).toFixed(2)}s for $${prize}. You’re up next — Speed Wins Always.`,

    // Original message — tightened for X
    `💥 ${winner} just won $${prize} on ${team1} vs ${team2}! Answered in ${(time / 1000).toFixed(2)}s ⚡ Speed Wins. Always.`,
  ];

  // Pick a random template
  const selectedTemplate =
    templates[Math.floor(Math.random() * templates.length)];

  // Replace placeholders
  const body = selectedTemplate;

  // Pick a random template
  const selectedTemplateTweet =
    tweetTemplates[Math.floor(Math.random() * tweetTemplates.length)];

  // Replace placeholders
  const tweet = selectedTemplateTweet;

  // Post to all platforms
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Photo Finish Post Generator
async function PhotoFinishPost({
  winner,
  loser,
  diff,
  winTime,
  loseTime,
  mediaToUpload,
  captionLink,
  round,
  amountWon,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
INSANE FINISH! 🏁  
${winner} beats ${loser} by just ${diff} seconds!  
Winner: ${(winTime / 1000).toFixed(2)}s  
Runner-up: ${(loseTime / 1000).toFixed(2)}s

Every millisecond counts!  
Speed Wins. Always. 📸
  `;

  const tweet = `
⚡ @${winner}: $${amountWon} in ${(winTime / 1000).toFixed(1)} seconds!

Q${round} Contest Winner
Square "${round}"

Your knowledge. Your speed. Your money.

SPEED WINS. ALWAYS.

link: ${captionLink}
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// 3. Daily/Weekly Summaries

// Trigger: Before and during a board/game filling.
// Board Going Fast → When a board is >70% full.
// New Board Alert → As soon as a new game board is created.
// Final Call → 1–2 hours before kickoff/start.
// Prime Squares Alert → When statistically strong/“hot” squares are still unclaimed.
// Board Full Announcement → Once a board is sold out (100% full).
// Multi-Game Update → On days with multiple live games (daily snapshot).
// Tier Status Update → When high-value tiers are nearly sold out but not full.

// Board Going Fast
async function BoardGoingFastPost({
  team1,
  team2,
  tier,
  totalClaims,
  mediaToUpload,
  captionLink,
}) {
  const total = totalClaims?.total || 0;
  const claimed = totalClaims?.claimed || 0;
  const left = Math.max(total - claimed, 0);
  const leftPercent = total > 0 ? ((claimed / total) * 100).toFixed(0) : 0;

  // 🧩 Extract numeric value if tier is like "tier_25"
  const tierValue =
    typeof tier === "string" && tier.startsWith("tier_")
      ? tier.replace("tier_", "")
      : tier;

  const tierLine = `$${tierValue} Tier: ${
    left > 0 ? `${left} squares left (${leftPercent}% filled)` : "SOLD OUT"
  }`;

  const cta = getRandomCTA({ link: captionLink });
  const body = `
🔥 ${team1} vs ${team2} filling up FAST!  

${tierLine}

Get your square before kickoff!  
Speed Wins. Always. ⚡
  `;

  const tweet = `
🔥 ${team1} vs ${team2} filling up fast! 
${tierLine} 
Grab your square — Speed Wins Always. ⚡
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body.trim(), cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// New Board Alert
async function NewBoardAlertPost({
  team1,
  team2,
  day,
  time,
  mediaToUpload,
  captionLink,
  enabledTiers,
}) {
  const cta = getRandomCTA({ link: captionLink });


  // 🧠 Generate all tier messages from enabledTiers
  const tierMessages = enabledTiers
    .map((tier) => {
      const tierNumber = tier.split("_")[1];
      const amount = tierAmounts[tier];
      return `💰 $${tierNumber} → Win $${amount} per quarter`;
    })
    .join("\n");

  const tierTweet = enabledTiers
    .map((tier) => {
      const tierNumber = tier.split("_")[1];
      const amount = tierAmounts[tier];
      return `💰 $${tierNumber} → Win $${amount}/QT`;
    })
    .join("\n");

  const body = `
🚨 NEW BOARD LIVE 🚨  

${team1} vs ${team2} - ${day} ${(time / 1000).toFixed(2)}  

All tiers available NOW:
${tierMessages}

First come, first served!  
Speed Wins. Always.
`;
  const tweet = ` 

${team1} vs ${team2} - ${day} ${(time / 1000).toFixed(2)}  

All tiers available NOW:
${tierTweet}
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Final Call
async function FinalCallPost({
  team1,
  team2,
  timeLeft,
  squaresLeft,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
⏰ LAST CHANCE: ${team1} vs ${team2}  

Game starts in ${timeLeft}!  
${squaresLeft} squares remaining  

Don't watch from the sidelines.  
Speed Wins. Always. 🎯
  `;

  const tweet = `
⏰ LAST CHANCE! ${team1} vs ${team2} — starts in ${timeLeft}! 
Only ${squaresLeft} squares left. 
Don’t wait — Speed Wins Always. 🎯
`;
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Board Full Announcement
async function BoardFullAnnouncementPost({
  team1,
  team2,
  totalPrize,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
SOLD OUT! ${team1} vs ${team2} is LOCKED IN! 🔒  

100 players competing for $${totalPrize}  
Fastest fingers will win.  

Check other games or join the waitlist.  
Speed Wins. Always. 💪
  `;

  const tweet = `
🔒 SOLD OUT! ${team1} vs ${team2} is locked in!  
${totalPrize} up for grabs — 100 players ready to race.  
Check other games.  
Speed Wins Always. 💪
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Multi-Game Update
async function MultiGameUpdatePost({ games, mediaToUpload, captionLink, day }) {
  // games example: [{match: "Cowboys vs Eagles", fill: "85%"}, ...]
  const cta = getRandomCTA({ link: captionLink });

  const gameLines = games
    .map((g) => {
      const timePart = new Date(g.gameDate).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${g.teams.home} vs ${g.teams.away} -> ${timePart}`;
    })
    .join("\n");
  const gameLinestweet = games
    .slice(0, 3)
    .map((g) => `${g.match}: ${g.fill} FULL`)
    .join("\n");
  const body = `
📊 ${day} Board Status:  

${gameLines}

Get in NOW before they're gone!  
Speed Wins. Always.
  `;
  const tweet = `
📊 ${day} Board Update:  
${gameLinestweet} 
and others
Join now — Speed Wins Always. ⚡
`;
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Tier Status Update
async function TierStatusUpdatePost({
  team1,
  team2,
  tiers,
  mediaToUpload,
  captionLink,
}) {
  // tiers example: [{tier: 1000, left: 2}, {tier: 500, left: 0}, ...]
  const cta = getRandomCTA({ link: captionLink });
  const tierLines = tiers
    .map(
      (t) =>
        `$${t.tier} Tier: ${
          t.left > 0 ? `${t.left} squares left!` : "SOLD OUT"
        }`
    )
    .join("\n");
  const tierLinestweet = tiers
    .slice(0, 3)
    .map(
      (t) =>
        `$${t.tier} Tier: ${
          t.left > 0 ? `${t.left} squares left!` : "SOLD OUT"
        }`
    )
    .join("\n");
  const body = `
🎯 ${team1} vs ${team2} Availability:  

${tierLines}

Big money squares going fast!  
Speed Wins. Always. 💰
  `;

  const tweet = `
🎯 ${team1} vs ${team2} Availability:  

${tierLinestweet}

Big money squares going fast!  
Speed Wins. Always. 💰
  `;
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// 3. Daily/Weekly Summaries

// Trigger: Scheduled posts (auto-cron).
// Daily Recap → End of each day (summarize wins, biggest prize, fastest player).
// Weekly Champion → Every Sunday evening or Monday morning (show leaderboard).

// Daily Recap
async function DailyRecapPost({
  totalPrizes,
  winnerCount,
  fastestTime,
  fastestUser,
  biggestWin,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
📊 Today's Square Trivia Stats:  
💰 $${totalPrizes} won  
🏆 ${winnerCount} winners  
⚡ Fastest: ${fastestTime / 1000}s  by ${fastestUser}  
🔥 Biggest: $${biggestWin}  

Your sports knowledge = real money!
  `;

  const tweet = `
📊 Square Trivia Stats:  
💰 $${totalPrizes} won | 🏆 ${winnerCount} winners  
⚡ Fastest: ${fastestTime / 1000}s  by ${fastestUser}  
🔥 Biggest Win: $${biggestWin}  
Your sports knowledge = real money!
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// 🏆 Weekly Champion Post
async function WeeklyChampionPost({
  winner1,
  amount1,
  wins1,
  winner2,
  amount2,
  wins2,
  winner3,
  amount3,
  wins3,
  mediaToUpload,
  captionLink,
}) {
  // CTA for the caption
  const cta = getRandomCTA({ link: captionLink });

  // Helper to format leaderboard lines
  const formatLine = (place, name, amount, wins) =>
    `${place} ${name} - $${amount} (${wins} wins)`;

  // ✅ Build winner list dynamically
  const winnerLines = [];
  if (winner1) winnerLines.push(formatLine("🥇", winner1, amount1, wins1));
  if (winner2) winnerLines.push(formatLine("🥈", winner2, amount2, wins2));
  if (winner3) winnerLines.push(formatLine("🥉", winner3, amount3, wins3));

  // ❌ If no winners at all, don't post
  if (winnerLines.length === 0) {
    console.log("⚠️ No winners this week — skipping WeeklyChampionPost.");
    return null;
  }

  // Main caption body
  const body = `
👑 This Week's Square Trivia Champions:

${winnerLines.join("\n")}

Think you can make next week's list? 🎯
  `.trim();

  // Shorter tweet version
  const tweet = `
👑 This Week Summary:
${winnerLines.join("\n")}
  `.trim();

  // Post to all platforms
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// 4. Game Promotion

// Trigger: Pre-game marketing.
// Upcoming Game → When new games for the week are announced (2–3 days before kickoff).
// Last Chance → 2–3 hours before game start (or when <20% of squares left).

// Upcoming Game
async function UpcomingGamePost({ team1, team2, mediaToUpload, captionLink }) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
🏈 ${team1} vs ${team2} boards are LIVE!  

Tiers available:  
✅ $25 tier - Win $200/quarter  
✅ $50 tier - Win $450/quarter  
✅ $100 tier - Win $900/quarter  

NO FEES - Answer fast, win big!
  `;

  const tweet = `
🏈 ${team1} vs ${team2} boards are LIVE!  
💰 Tiers:  
✅ $25 → Win $200/Q  
✅ $50 → Win $450/Q  
✅ $100 → Win $900/Q  
No fees. Answer fast, win big! ⚡
`;
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Upcoming Game
async function LastChancePost({
  team1,
  team2,
  spotsLeft,
  highestTier,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
⏰ FINAL CALL: ${team1} vs ${team2} kicks off in 2 hours!  

Still ${spotsLeft} squares available.  
Biggest tier still open: $${highestTier}  

Don't miss out! 🎯
  `;
  const tweet = `
⏰ FINAL CALL! ${team1} vs ${team2} kicks off in 2 hrs!  
${spotsLeft} squares left — biggest tier: $${highestTier}.  
Don’t miss out! 🎯
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// . Milestone / Special Events

// Trigger: Periodically to build credibility + after payouts.
// NO FEES Emphasis → Weekly reminder OR after payouts are processed.
// Skill Celebration → After a notable fast answer win (especially when users confuse with “luck-based” games).

// Platform Milestone
async function PlatformMilestonePost({
  amount,
  totalWinners,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
🎉 MILESTONE ALERT!  

We've now paid out over $${amount} in prizes!  
${totalWinners} winners and counting.  
All skill, no luck!  

Thank you for making Square Trivia the fastest growing skill-based platform! 💪
  `;

  const tweet = `
🎉 MILESTONE ALERT!  
Over $${amount} paid out to ${totalWinners}+ winners! 💰  
All skill. No luck.  
Square Trivia the fastest-growing skill platform! 💪
`;
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Record Breaker Post Generator
async function RecordBreakerPost({
  winner,
  time,
  oldTime,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink, time: time });
  const body = `
🚨 NEW RECORD! 🚨  

${winner} just set the fastest answer time this week: ${(time / 1000).toFixed(2)} seconds!  
Previous record: ${oldTime / 1000}s  

Think you can beat it? Speed pays! ⚡
  `;

  const tweet = `
🚨 NEW RECORD! 🚨  
${winner} just answered in ${(time / 1000).toFixed(2)}s — fastest this week!  
Previous best: ${oldTime / 1000}s .  
Think you can beat it? Speed pays! ⚡
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// TRUST BUILDINGS

// Trigger: Platform growth milestones or record events.
// Platform Milestone → When total payouts cross a big milestone ($10k, $50k, $100k).
// Record Breaker → When someone sets a new fastest-answer record.

// No Fees Post Generator
async function NoFeesPost({ mediaToUpload, captionLink }) {
  const cta = getRandomCTA({ link: captionLink });
  const options = [
    { icon: "⚡", title: "Express service", detail: "Get 92% today" },
    { icon: "⏰", title: "Standard service", detail: "Get 100% in 2–3 days" },
  ]
    .map((o) => `${o.icon} ${o.title}: ${o.detail}`)
    .join("\n");
  const body = `
Win $200? Get paid $200! NO FEES on Square Trivia!  

${options}

Your choice, your money!
  `;

  const tweet = `
💸 Win $200? Get $200 — NO FEES on Square Trivia!  
⚡ Express: Get 92% today  
⏰ Standard: Get 100% in 2–3 days  
Your choice. Your money!
`;
  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Skill Celebration Post Generator
async function SkillCelebration({
  recentWinner,
  time,
  prize,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink, time: time });
  const comparisons = [
    { icon: "🎲", label: "Traditional squares", desc: "Hope for luck" },
    { icon: "⚡", label: "Square Trivia winners", desc: "Trust their speed" },
  ]
    .map((c) => `${c.label}: ${c.icon} ${c.desc}`)
    .join("\n");
  const body = `
What separates Square Trivia winners from everyone else?

${comparisons}

${recentWinner} just proved it with a ${(time / 1000).toFixed(2)}s answer for $${prize}!
Speed Wins. Always. 🧠💰 
  `;

  const tweet = `
What separates Square Trivia winners?  
🎲 Traditional squares: Hope for luck  
⚡ Square Trivia: Trust your speed  
${recentWinner} just nailed a ${(time / 1000).toFixed(2)}s answer for $${prize}!  
Speed Wins Always. 🧠💰
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Engagement Builders

// Trigger: Weekly, to drive conversation and competition.
// Referral Leaderboard → Weekly (Sunday night / Monday morning).
// Team Rivalry → Post mid-week OR before a major rivalry game (Cowboys vs Eagles, Chiefs vs Bills, etc.).

// Team Rivalry Post Generator
async function TeamRivalryPost({
  teamA,
  teamB,
  teamAWins,
  teamBWins,
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const body = `
Battle of the Fanbases! 🏈

${teamA} fans: ${teamAWins} wins this week  
${teamB} fans: ${teamBWins} wins this week  

Who knows their team better? Prove it on Sunday!
  `;

  const tweet = `
🏈 Battle of the Fanbases!  
${teamA} fans: ${teamAWins} wins  
${teamB} fans: ${teamBWins} wins  
Who knows their team better? Prove it Sunday! 💥
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Referral Leaderboard Post Generator
async function ReferralLeaderboard({
  winners = [],
  mediaToUpload,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink });
  const leaderboard = winners
    .map(
      (w, i) =>
        `${i + 1}. ${w.name}: $${w.amount} won from ${w.referrals} referrals`
    )
    .join("\n");
  const body = `
🏆 This Week's Referral Winners:

${leaderboard}

These players win on the board AND off the board.
Speed Wins. Always. 💰
  `;

  const tweet = `
🏆 This Week’s Referral Leaders:  
${leaderboard}  
Winning on and off the board.  
Speed Wins Always. 💰
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    link: captionLink,
    tweet: buildTemplate(tweet),
  });
}

// Platform-Specific Variations (Discussion Needed):

// Twitter (Short) → Auto-adapt from Winner/Recap templates, compressed.
// Instagram (Visual) → Use Winner Announcement + image card designs.
// Telegram (Rich) → Winner templates expanded with Markdown formatting.
// Platform-Specific Winner Post Generators

// Twitter (Short) Winner Post Generator
async function WinnerPostTwitter({
  winnerName,
  prize,
  gameName,
  time,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink, time: time });
  const body = `
${winnerName} ➡️ $${prize}${time ? ` ⚡ ${(time / 1000).toFixed(2)}s` : ""}

${gameName}: Where speed pays 🏁

#SkillNotLuck
  `;

  const post = buildTemplate(body, cta);
  await postTweet(post);
  return post;
}

// Instagram (Visual) Winner Post Generator
async function WinnerPostInstagram({
  winnerName,
  team,
  prize,
  time,
  mediaToUpload,
  imageUrl,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink, time: time });
  const body = `
[IMAGE: ${imageUrl || "Winner card 🏆"}]

When your ESPN addiction finally pays off 💰

${winnerName} turned their ${team} knowledge into $${prize} with a lightning-fast ${(time / 1000).toFixed(2)}s answer!

NO FEES. Just skill. Just speed. Just win. ⚡
  `;

  const tweet = `
🏆 When your ESPN addiction finally pays off 💰  
${winnerName} turned ${team} knowledge into $${prize} with a ${(time / 1000).toFixed(2)}s answer!  
NO FEES. Just skill. Just speed. Just win. ⚡  
[IMAGE: ${imageUrl || "Winner card 🏆"}]
`;

  return postToAllPlatforms({
    media: mediaToUpload,
    caption: buildTemplate(body, cta),
    tweet: buildTemplate(tweet),
  });
}

// Telegram (Rich) Winner Post Generator
async function WinnerPostTelegram({
  winnerName,
  prize,
  time,
  team1,
  team2,
  square,
  triviaQuestion,
  answer,
  captionLink,
}) {
  const cta = getRandomCTA({ link: captionLink, time: time });
  const body = `
🔥 *WINNER ALERT* 🔥

*Player:* ${winnerName}
*Prize:* $${prize}
*Answer Time:* ⚡ ${(time / 1000).toFixed(2)}s
*Game:* ${team1} vs ${team2}
*Square:* ${square}

_"${triviaQuestion}"_
Answer: *${answer}*

Think you could’ve been faster? Join now - NO FEES!
  `;

  const post = buildTemplate(body, cta);
  await igPublish({ caption: post });
  return post;
}

// Exports

module.exports = {
  // Winner Announcements
  BigWinPost,
  StandardWinPost,
  PhotoFinishPost,
  //2. Board Status & Promotions
  BoardGoingFastPost,
  NewBoardAlertPost,
  FinalCallPost,
  BoardFullAnnouncementPost,
  MultiGameUpdatePost,
  TierStatusUpdatePost,
  // Daily/Weekly Summaries
  DailyRecapPost,
  WeeklyChampionPost,
  // Export Game Promotion Posts
  UpcomingGamePost,
  LastChancePost,
  // Milestone / Special Event Posts
  PlatformMilestonePost,
  RecordBreakerPost,
  //Trust Buildings
  NoFeesPost,
  SkillCelebration,
  // Export Engagement Builders
  ReferralLeaderboard,
  TeamRivalryPost,
  // Export platform-specific functions
  WinnerPostTwitter,
  WinnerPostInstagram,
  WinnerPostTelegram,
  tierAmounts,
};
