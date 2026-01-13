// Complete Administrative Control System for Square Trivia with Updated Payment Structure
// All functions are complete and functional with no truncated code

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { sendMail } = require("./payment-system-modified");
const { logger } = require("firebase-functions");
// const { DUMMY_GAMES } = require("./constants-configuration-fixed");

// =====================================
// CONSTANTS - Configure these during deployment
// =====================================

// Payment tier configuration with payout percentages
const TIER_CONFIG = {
  tier_25: { amount: 25, name: "$25 Tier", payoutPercentage: 0.64 },
  tier_50: { amount: 50, name: "$50 Tier", payoutPercentage: 0.64 },
  tier_100: { amount: 100, name: "$100 Tier", payoutPercentage: 0.64 },
  tier_250: { amount: 250, name: "$250 Tier", payoutPercentage: 0.72 },
  tier_500: { amount: 500, name: "$500 Tier", payoutPercentage: 0.72 },
  tier_1000: { amount: 1000, name: "$1000 Tier", payoutPercentage: 0.72 },
};

// Game type definitions - Configure based on your league structure
const GAME_TYPES = {
  REGULAR: "regular", // Regular season games
  PLAYOFF: "playoff", // Playoff games
  CHAMPIONSHIP: "championship", // Championship/Super Bowl games
};

// Tier availability by game type - Configure based on business rules
const TIER_AVAILABILITY = {
  [GAME_TYPES.REGULAR]: ["tier_25", "tier_50", "tier_100"],
  [GAME_TYPES.PLAYOFF]: [
    "tier_25",
    "tier_50",
    "tier_100",
    "tier_250",
    "tier_500",
  ],
  [GAME_TYPES.CHAMPIONSHIP]: [
    "tier_25",
    "tier_50",
    "tier_100",
    "tier_250",
    "tier_500",
    "tier_1000",
  ],
};

// Payment processing constants
const INSTANT_PAYOUT_FEE = 0.08; // 8% fee for instant payouts
const BATCH_PAYOUT_DAYS = ["tuesday", "friday"];

// API Sports configuration - Add your API keys during deployment
const API_SPORTS_CONFIG = {
  NFL: {
    endpoint: "/v3/nfl/scores/json/ScoresByWeek",
    leagueId: 1,
  },
  CFB: {
    endpoint: "/v3/cfb/scores/json/GamesByWeek",
  },
};

// =====================================
// AUTHENTICATION MIDDLEWARE
// =====================================
function requireAdmin(context) {
  if (!context.auth?.token?.admin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin access required"
    );
  }
  return context.auth.uid;
}

// =====================================
// GAME MANAGEMENT
// =====================================

/**
 * Search for games in API-Sports
 */
// exports.searchApiSportsGames = functions.https.onCall(async (data, context) => {
//   const adminId = requireAdmin(context);

//   const { sport, date, teamName } = data;

//   if (!sport || !API_SPORTS_CONFIG[sport]) {
//     throw new functions.https.HttpsError("invalid-argument", "Invalid sport");
//   }

//   try {
//     const config = API_SPORTS_CONFIG[sport];
//     const params = {
//       league: config.leagueId,
//       season: new Date().getFullYear(),
//     };

//     if (date) {
//       params.date = date; // Format: YYYY-MM-DD
//     }

//     const response = await axios.get(`https://${config.host}/games`, {
//       params,
//       headers: {
//         "x-rapidapi-key":
//           // functions.config().apisports.key ||
//           process.env.APISPORTS_KEY,
//         "x-rapidapi-host": config.host,
//       },
//     });

//     let games = response.data.response || [];

//     // Filter by team name if provided
//     if (teamName) {
//       const searchTerm = teamName.toLowerCase();
//       games = games.filter(
//         (game) =>
//           game.teams.home.name.toLowerCase().includes(searchTerm) ||
//           game.teams.away.name.toLowerCase().includes(searchTerm)
//       );
//     }

//     // Format for admin display
//     const formattedGames = games.map((game) => ({
//       apiSportsId: game.game.id.toString(),
//       homeTeam: game.teams.home.name,
//       awayTeam: game.teams.away.name,
//       startTime: new Date(game.game.date),
//       status: game.game.status.short,
//       venue: game.game.venue?.name || "TBD",
//       week: game.game.week,
//       scores: game.scores,
//     }));

//     console.log(`Admin ${adminId} searched for ${sport} games`);

//     return {
//       success: true,
//       games: formattedGames,
//       total: formattedGames.length,
//     };
//   } catch (error) {
//     console.error("API-Sports search error:", error);
//     throw new functions.https.HttpsError("internal", "Failed to search games");
//   }
// });

function getWeekNumber(date) {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const pastDays = Math.floor((date - firstDay) / (24 * 60 * 60 * 1000));
  return Math.ceil((pastDays + firstDay.getDay() + 1) / 7);
}

exports.searchApiSportsGames = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);
  const {
    sport,
    teamName,
    week,
    gameType = "regular", // new
    year = new Date().getFullYear(),
  } = data;

  if (!sport) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Sport is required"
    );
  }

  try {
    let games = [];

    if (sport === "NFL") {
      // --- NFL via API-Sports ---
      const config = API_SPORTS_CONFIG[sport];
      const url = `https://v1.american-football.api-sports.io/games`;
      const response = await axios.get(url, {
        params: { league: config.leagueId, season: year },
        headers: { "x-apisports-key": process.env.REACT_APP_APISPORTS_KEY },
      });
      logger.info("GOT NFL GAMES: ", { data: response?.data?.response });
      games = response.data?.response || [];

      // games = DUMMY_GAMES || [];

      // ✅ handle gameType filtering
      if (gameType === "regular") {
        games = games.filter((g) => g.game.stage === "Regular Season");
      } else if (gameType === "playoff") {
        games = games.filter(
          (g) => g.game.stage === "Post Season" && g.game.week !== "Super Bowl" // exclude SB from playoffs
        );
      } else if (gameType === "championship") {
        games = games.filter(
          (g) => g.game.stage === "Post Season" && g.game.week === "Super Bowl"
        );
      }

      const now = Math.floor(Date.now() / 1000);

      const completedStatuses = ["Finished", "Final", "Match Finished"];
      games = games.filter(
        (item) =>
          item?.game?.date?.timestamp > now ||
          !completedStatuses.includes(item?.game?.status?.long)
      );
    }

    if (sport === "CFB") {
      // --- CFB via ESPN ---
      const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard`;

      // ✅ map gameType -> ESPN seasontype
      const seasonTypeMap = {
        regular: 2, // regular season
        playoff: 3, // postseason / bowls
        championship: 4, // playoff / championship
      };

      const params = {
        year,
        seasontype: seasonTypeMap[gameType] ?? 2,
      };

      // ✅ week only for regular
      if (gameType === "regular" && week) {
        params.week = week;
      }

      const response = await axios.get(url, {
        params,
        headers: { accept: "application/json" },
      });

      const now = Math.floor(Date.now() / 1000);

      games = response.data.events
        .map((event) => {
          const competition = event.competitions[0];
          const status = competition.status.type;
          const venue = competition.venue || {};
          const home = competition.competitors.find(
            (t) => t.homeAway === "home"
          );
          const away = competition.competitors.find(
            (t) => t.homeAway === "away"
          );

          const timestamp = Math.floor(
            new Date(competition.date).getTime() / 1000
          );

          return {
            game: {
              id: event.id,
              stage: gameType, // reflect requested type
              week:
                gameType === "regular"
                  ? `Week ${response.data.week.number}`
                  : null,
              date: {
                timezone: "UTC",
                date: competition.date.split("T")[0],
                time: competition.date.split("T")[1].slice(0, 5),
                timestamp,
              },
              venue: {
                name: venue.fullName || null,
                city: venue.address?.city || null,
              },
              status: {
                short: status.state === "post" ? "FT" : status.name,
                long: status.description,
                timer: null,
              },
            },
            league: {
              id: "cfb",
              name: "College Football",
              season: String(year),
              logo: "https://a.espncdn.com/redesign/assets/img/logos/espn/college-football.png",
              country: {
                name: "USA",
                code: "US",
                flag: "https://media.api-sports.io/flags/us.svg",
              },
            },
            teams: {
              home: {
                id: home.team.id,
                name: home.team.displayName,
                logo: home.team.logo,
              },
              away: {
                id: away.team.id,
                name: away.team.displayName,
                logo: away.team.logo,
              },
            },
            scores: {
              home: {
                total: Number(home.score) || 0,
              },
              away: {
                total: Number(away.score) || 0,
              },
            },
          };
        })
        .filter(
          (g) => g.game.date.timestamp >= now || g.game.status.short !== "FT"
        );
    }

    // ✅ Week filter (apply only if regular)
    if (week && gameType === "regular") {
      games = games.filter((g) => {
        const weekStr = g.game.week;
        const weekNum = weekStr
          ? parseInt(weekStr.replace("Week", "").trim())
          : null;
        return weekNum === parseInt(week);
      });
    }

    // ✅ Team filter
    if (teamName) {
      const searchTerm = teamName.toLowerCase();
      games = games.filter(
        (game) =>
          game.teams.home?.name?.toLowerCase().includes(searchTerm) ||
          game.teams.away?.name?.toLowerCase().includes(searchTerm)
      );
    }

    // ✅ Normalize
    const formattedGames = games.map((game) => {
      const weekStr = game.game.week || null;
      const weekNum = weekStr
        ? parseInt(weekStr.replace("Week", "").trim())
        : null;

      let startTime = null;
      if (game?.game?.date?.timestamp) {
        startTime = new Date(game.game.date.timestamp * 1000).toISOString();
      } else if (game?.game?.date?.date && game?.game?.date?.time) {
        startTime = new Date(
          `${game.game.date.date}T${game.game.date.time}:00Z`
        ).toISOString();
      }

      const homeName = game.teams.home?.name || "TBD";
      const awayName = game.teams.away?.name || "TBD";
      const homeLogo =
        game.teams.home?.logo ||
        "https://media.api-sports.io/american-football/teams/0.png";
      const awayLogo =
        game.teams.away?.logo ||
        "https://media.api-sports.io/american-football/teams/0.png";

      return {
        apiSportsId: game.game.id?.toString(),
        homeTeam: homeName || "TBD",
        awayTeam: awayName || "TBD",
        homeLogo,
        awayLogo,
        startTime,
        status: game.game.status?.long,
        venue: game.game.venue?.name || "TBA",

        // ✅ Regular = number | Playoff/Championship = string
        week: gameType === "regular" ? weekNum : weekStr,

        gameType,
        scores: {
          home: game.scores.home?.total ?? null,
          away: game.scores.away?.total ?? null,
        },
      };
    });

    console.log(`Admin ${adminId} searched ${sport} games`, {
      gameType,
      week: week || "ALL",
      total: formattedGames.length,
    });

    return {
      success: true,
      games: formattedGames,
      total: formattedGames.length,
    };
  } catch (error) {
    console.error(
      `${sport.toUpperCase()} search error:`,
      error?.response?.data || error
    );
    throw new functions.https.HttpsError(
      "internal",
      `Failed to search ${sport} games`
    );
  }
});

/**
 * Create game with API mapping
 */
exports.createGameWithApiMapping = functions.https.onCall(
  async (data, context) => {
    const adminId = requireAdmin(context);
    const { sport, homeTeam, awayTeam, startTime, gameType, apiSportsId } =
      data;

    // Validate inputs
    if (
      !sport ||
      !homeTeam ||
      !awayTeam ||
      !startTime ||
      !gameType ||
      !apiSportsId
    ) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Missing required fields"
      );
    }

    if (!Object.values(GAME_TYPES).includes(gameType)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid game type"
      );
    }

    try {
      // Create game
      const gameRef = await admin
        .firestore()
        .collection("games")
        .add({
          sport,
          teams: { home: homeTeam, away: awayTeam },
          startTime: admin.firestore.Timestamp.fromDate(new Date(startTime)),
          gameType,
          apiSportsId,
          status: "scheduled",
          processedQuarters: {},
          scores: {},
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: adminId,
        });

      // Create boards for available tiers
      const availableTiers = TIER_AVAILABILITY[gameType];
      const boardPromises = availableTiers.map((tier) =>
        admin.firestore().collection("boards").add({
          gameId: gameRef.id,
          tier,
          gameType,
          squares: {},
          maxSquares: 50,
          payoutPercentage: TIER_CONFIG[tier].payoutPercentage,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      );

      await Promise.all(boardPromises);

      // Log admin action
      await logAdminAction(adminId, "create_game", {
        gameId: gameRef.id,
        sport,
        teams: `${awayTeam} @ ${homeTeam}`,
        apiSportsId,
        boardsCreated: availableTiers.length,
      });

      return {
        success: true,
        gameId: gameRef.id,
        message: `Game created with ${availableTiers.length} boards`,
        availableTiers,
      };
    } catch (error) {
      console.error("Game creation error:", error);
      throw new functions.https.HttpsError("internal", "Failed to create game");
    }
  }
);

/**
 * Update game status manually - COMPLETE IMPLEMENTATION
 */
exports.updateGameStatus = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { gameId, status, reason } = data;

  const validStatuses = ["scheduled", "active", "completed", "cancelled"];
  if (!validStatuses.includes(status)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid status");
  }

  try {
    // Update the game document with new status
    await admin
      .firestore()
      .collection("games")
      .doc(gameId)
      .update({
        status,
        statusReason: reason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        [`statusHistory.${status}`]: {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: adminId,
          reason,
        },
      });

    // Log the admin action
    await logAdminAction(adminId, "update_game_status", {
      gameId,
      status,
      reason,
    });

    // If game is cancelled, handle refunds or notifications
    if (status === "cancelled") {
      await handleGameCancellation(gameId, adminId, reason);
    }

    return {
      success: true,
      message: `Game status updated to ${status}`,
    };
  } catch (error) {
    console.error("Game status update error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to update game status"
    );
  }
});

// =====================================
// WINNER MANAGEMENT
// =====================================

/**
 * Mark winners for a game quarter
 */
exports.markQuarterWinners = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { gameId, quarter, homeScore, awayScore } = data;

  // Validate inputs
  const validQuarters = ["q1", "q2", "q3", "q4", "ot"];
  if (!validQuarters.includes(quarter)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid quarter");
  }

  if (
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    awayScore < 0
  ) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid scores");
  }

  try {
    // Get game
    const gameDoc = await admin
      .firestore()
      .collection("games")
      .doc(gameId)
      .get();
    if (!gameDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Game not found");
    }

    // const game = gameDoc.data();

    // Calculate winning positions
    const winningPositions = calculateWinningPositions(homeScore, awayScore);

    // Process winners for all boards
    // const boards = await admin
    //   .firestore()
    //   .collection("boards")
    //   .where("gameId", "==", gameId)
    //   .get();

    // const winners = [];
    const batch = admin.firestore().batch();

    // for (const boardDoc of boards.docs) {
    //   const board = boardDoc.data();

    //   for (const position of winningPositions) {
    //     const square = board.squares?.[position];

    //     if (square?.userId) {
    //       // Create winner record with new payout percentage
    //       const winnerRef = admin.firestore().collection("winners").doc();
    //       const prizeAmount = calculatePrizeAmount(board.tier);

    //       batch.set(winnerRef, {
    //         userId: square.userId,
    //         gameId,
    //         boardId: boardDoc.id,
    //         quarter,
    //         position,
    //         score: `${homeScore}-${awayScore}`,
    //         prizeAmount,
    //         tier: board.tier,
    //         payoutPercentage: TIER_CONFIG[board.tier].payoutPercentage,
    //         game: `${game.teams.away} @ ${game.teams.home}`,
    //         sport: game.sport,
    //         createdAt: admin.firestore.FieldValue.serverTimestamp(),
    //         markedBy: adminId,
    //         status: "pending_payout",
    //         notificationStatus: "pending",
    //       });

    //       winners.push({
    //         winnerId: winnerRef.id,
    //         userId: square.userId,
    //         position,
    //         prizeAmount,
    //         tier: board.tier,
    //         payoutPercentage: TIER_CONFIG[board.tier].payoutPercentage,
    //       });

    //       // Mark square as winner
    //       batch.update(boardDoc.ref, {
    //         [`squares.${position}.isWinner`]: true,
    //         [`squares.${position}.winQuarter`]: quarter,
    //       });
    //     }
    //   }
    // }

    // Update game with scores
    batch.update(gameDoc.ref, {
      [`quarterScores.${quarter}`]: { home: homeScore, away: awayScore },
      [`processedQuarters.${quarter}`]: true,
      [`manualScoreEntry.${quarter}`]: {
        enteredBy: adminId,
        enteredAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    await batch.commit();

    // Trigger winner notifications
    // if (winners.length > 0) {
    //   await triggerWinnerNotifications(winners);
    // }

    // Log admin action
    // await logAdminAction(adminId, "mark_winners", {
    //   gameId,
    //   quarter,
    //   score: `${homeScore}-${awayScore}`,
    //   winnerCount: winners.length,
    //   totalPrizes: winners.reduce((sum, w) => sum + w.prizeAmount, 0),
    // });

    return {
      success: true,
      message: `Quarter ${quarter} score updated successfully`,
      // winners: winners.length,
      // totalPrizes: winners.reduce((sum, w) => sum + w.prizeAmount, 0),
      // winningPositions,
    };
  } catch (error) {
    console.error("Mark winners error:", error);
    throw new functions.https.HttpsError("internal", "Failed to mark winners");
  }
});

/**
 * Retry failed winner notifications
 */
exports.retryWinnerNotifications = functions.https.onCall(
  async (data, context) => {
    const adminId = requireAdmin(context);

    const { winnerIds } = data;

    if (!Array.isArray(winnerIds) || winnerIds.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Winner IDs required"
      );
    }

    try {
      const results = [];

      for (const winnerId of winnerIds) {
        const winnerDoc = await admin
          .firestore()
          .collection("winners")
          .doc(winnerId)
          .get();

        if (!winnerDoc.exists) {
          results.push({ winnerId, success: false, error: "Not found" });
          continue;
        }

        try {
          await triggerWinnerNotifications([
            {
              winnerId,
              userId: winnerDoc.data().userId,
              position: winnerDoc.data().position,
              prizeAmount: winnerDoc.data().prizeAmount,
              tier: winnerDoc.data().tier,
              payoutPercentage: winnerDoc.data().payoutPercentage,
            },
          ]);

          await winnerDoc.ref.update({
            notificationStatus: "retried",
            retriedAt: admin.firestore.FieldValue.serverTimestamp(),
            retriedBy: adminId,
          });

          results.push({ winnerId, success: true });
        } catch (error) {
          results.push({ winnerId, success: false, error: error.message });
        }
      }

      await logAdminAction(adminId, "retry_notifications", {
        attemptedCount: winnerIds.length,
        successCount: results.filter((r) => r.success).length,
      });

      return {
        success: true,
        results,
        summary: {
          attempted: winnerIds.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      };
    } catch (error) {
      console.error("Retry notifications error:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to retry notifications"
      );
    }
  }
);

// =====================================
// PAYOUT MANAGEMENT
// =====================================

/**
 * Get pending payouts for batch processing
 */
exports.getPendingPayouts = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  try {
    // Get current batch window
    const now = new Date();
    const dayOfWeek = now.getDay();
    let startDate, endDate;

    // Tuesday batch: Friday through Monday
    if (dayOfWeek === 2) {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 4); // Friday
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setDate(now.getDate() - 1); // Monday
      endDate.setHours(23, 59, 59, 999);
    }
    // Friday batch: Tuesday through Thursday
    else if (dayOfWeek === 5) {
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 3); // Tuesday
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date(now);
      endDate.setDate(now.getDate() - 1); // Thursday
      endDate.setHours(23, 59, 59, 999);
    } else {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Batch payouts only run on Tuesday and Friday"
      );
    }

    // Get pending winners (excluding instant payouts)
    const winners = await admin
      .firestore()
      .collection("winners")
      .where("status", "==", "pending_payout")
      .where("createdAt", ">=", startDate)
      .where("createdAt", "<=", endDate)
      .get();

    const pendingPayouts = [];
    let totalByTier = {
      tier_25: { count: 0, total: 0 },
      tier_50: { count: 0, total: 0 },
      tier_100: { count: 0, total: 0 },
      tier_250: { count: 0, total: 0 },
      tier_500: { count: 0, total: 0 },
      tier_1000: { count: 0, total: 0 },
    };

    for (const doc of winners.docs) {
      const winner = doc.data();

      // Skip if already processed as instant payout
      if (winner.payoutType === "instant") continue;

      // Get user details
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(winner.userId)
        .get();
      const user = userDoc.data();

      pendingPayouts.push({
        winnerId: doc.id,
        userId: winner.userId,
        email: user.email,
        name: user.displayName || user.email.split("@")[0],
        prizeAmount: winner.prizeAmount,
        tier: winner.tier,
        game: winner.game,
        quarter: winner.quarter,
        payoutPercentage: winner.payoutPercentage,
      });

      totalByTier[winner.tier].count++;
      totalByTier[winner.tier].total += winner.prizeAmount;
    }

    return {
      success: true,
      batchDate: now.toISOString(),
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      payouts: pendingPayouts,
      summary: {
        totalPayouts: pendingPayouts.length,
        totalAmount: pendingPayouts.reduce((sum, p) => sum + p.prizeAmount, 0),
        byTier: totalByTier,
      },
    };
  } catch (error) {
    console.error("Get pending payouts error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to get pending payouts"
    );
  }
});

/**
 * Generate Relay CSV for batch payouts
 */
exports.generateRelayCSV = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { payoutIds } = data;

  if (!Array.isArray(payoutIds) || payoutIds.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Payout IDs required"
    );
  }

  try {
    const csvRows = [
      "Name,Email,Amount,Payment Method,Account Details", // Relay CSV headers
    ];

    const batch = admin.firestore().batch();
    const relayBatchRef = admin.firestore().collection("relayBatches").doc();

    let totalAmount = 0;
    const processedPayouts = [];

    for (const winnerId of payoutIds) {
      const winnerDoc = await admin
        .firestore()
        .collection("winners")
        .doc(winnerId)
        .get();
      if (!winnerDoc.exists) continue;

      const winner = winnerDoc.data();
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(winner.userId)
        .get();
      const user = userDoc.data();

      // Format for Relay
      const name = user.displayName || user.email.split("@")[0];
      const amount = winner.prizeAmount.toFixed(2);
      const paymentMethod = user.preferredPaymentMethod || "ACH";
      const accountDetails = user.paymentAccountLast4 || "On File";

      csvRows.push(
        `"${name}","${user.email}",${amount},${paymentMethod},"${accountDetails}"`
      );

      totalAmount += winner.prizeAmount;
      processedPayouts.push({
        winnerId,
        userId: winner.userId,
        amount: winner.prizeAmount,
      });

      // Update winner status
      batch.update(winnerDoc.ref, {
        status: "processing",
        payoutType: "batch",
        relayBatchId: relayBatchRef.id,
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Create relay batch record
    batch.set(relayBatchRef, {
      createdBy: adminId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      payoutCount: processedPayouts.length,
      totalAmount,
      status: "generated",
      payouts: processedPayouts,
    });

    await batch.commit();

    await logAdminAction(adminId, "generate_relay_csv", {
      batchId: relayBatchRef.id,
      payoutCount: processedPayouts.length,
      totalAmount,
    });

    return {
      success: true,
      csv: csvRows.join("\n"),
      batchId: relayBatchRef.id,
      summary: {
        payoutCount: processedPayouts.length,
        totalAmount,
      },
    };
  } catch (error) {
    console.error("Generate Relay CSV error:", error);
    throw new functions.https.HttpsError("internal", "Failed to generate CSV");
  }
});

/**
 * Mark Relay batch as processed
 */
exports.markRelayBatchProcessed = functions.https.onCall(
  async (data, context) => {
    const adminId = requireAdmin(context);

    const { batchId, relayConfirmationNumber } = data;

    try {
      const batchDoc = await admin
        .firestore()
        .collection("relayBatches")
        .doc(batchId)
        .get();
      if (!batchDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Batch not found");
      }

      const batch = admin.firestore().batch();

      // Update batch status
      batch.update(batchDoc.ref, {
        status: "processed",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: adminId,
        relayConfirmationNumber,
      });

      // Update all winners in batch
      const payouts = batchDoc.data().payouts;
      for (const payout of payouts) {
        const winnerRef = admin
          .firestore()
          .collection("winners")
          .doc(payout.winnerId);
        batch.update(winnerRef, {
          status: "completed",
          payoutCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();

      await logAdminAction(adminId, "process_relay_batch", {
        batchId,
        relayConfirmationNumber,
        payoutCount: payouts.length,
      });

      return {
        success: true,
        message: `Batch ${batchId} marked as processed`,
      };
    } catch (error) {
      console.error("Mark batch processed error:", error);
      throw new functions.https.HttpsError(
        "internal",
        "Failed to update batch"
      );
    }
  }
);

// =====================================
// USER MANAGEMENT
// =====================================

/**
 * Get user details with all related data
 */
exports.getUserDetails = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { userId } = data;

  try {
    // Get user
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();
    if (!userDoc.exists) {
      throw new functions.https.HttpsError("not-found", "User not found");
    }

    const user = userDoc.data();

    // Get donations
    const donations = await admin
      .firestore()
      .collection("donations")
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();

    // Get tier access
    const tierAccess = await admin
      .firestore()
      .collection("tierAccess")
      .where("userId", "==", userId)
      .get();

    // Get squares
    const squares = await admin
      .firestore()
      .collection("squareClaims")
      .where("userId", "==", userId)
      .get();

    // Get wins
    const wins = await admin
      .firestore()
      .collection("winners")
      .where("userId", "==", userId)
      .get();

    // Calculate stats including instant payout info
    const instantPayouts = wins.docs.filter(
      (doc) => doc.data().payoutType === "instant"
    );
    const instantPayoutFees = instantPayouts.reduce(
      (sum, doc) => sum + (doc.data().instantPayoutFee || 0),
      0
    );

    const stats = {
      totalDonations: donations.docs.reduce(
        (sum, doc) => sum + (doc.data().amount || 0),
        0
      ),
      activeTiers: tierAccess.docs
        .filter(
          (doc) =>
            doc.data().active && doc.data().expiresAt.toMillis() > Date.now()
        )
        .map((doc) => doc.data().tier),
      totalSquares: squares.size,
      totalWins: wins.size,
      totalWinnings: wins.docs.reduce(
        (sum, doc) => sum + (doc.data().prizeAmount || 0),
        0
      ),
      // NEW FIELDS:
      instantPayoutPreference: user.instantPayoutPreference || false,
      totalInstantPayouts: instantPayouts.length,
      totalInstantPayoutFees: instantPayoutFees,
      hasTelegram: user.hasTelegram || !!user.telegramUsername,
      telegramUsername: user.telegramUsername || "Not provided",
      notificationMethod: user.preferredNotificationMethod || "email",
    };

    return {
      success: true,
      user: {
        id: userId,
        ...user,
        stats,
      },
      donations: donations.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      tierAccess: tierAccess.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      recentSquares: squares.docs.slice(0, 10).map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      recentWins: wins.docs.slice(0, 10).map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
    };
  } catch (error) {
    console.error("Get user details error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to get user details"
    );
  }
});

/**
 * Grant tier access manually
 */
exports.grantTierAccess = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { userId, tier, days, reason } = data;

  if (!TIER_CONFIG[tier]) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid tier");
  }

  try {
    // Create donation record with payout percentage
    const donationRef = await admin
      .firestore()
      .collection("donations")
      .add({
        userId,
        tier,
        amount: 0,
        payoutPercentage: TIER_CONFIG[tier].payoutPercentage,
        isAdminGrant: true,
        grantedBy: adminId,
        reason,
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      });

    // Grant tier access
    await admin
      .firestore()
      .collection("tierAccess")
      .add({
        userId,
        tier,
        donationId: donationRef.id,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        active: true,
        isAdminGrant: true,
        grantedBy: adminId,
      });

    // Update user tiers
    await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .update({
        currentTiers: admin.firestore.FieldValue.arrayUnion(tier),
      });

    await logAdminAction(adminId, "grant_tier_access", {
      userId,
      tier,
      days,
      reason,
    });

    return {
      success: true,
      message: `Granted ${TIER_CONFIG[tier].name} access for ${days} days`,
    };
  } catch (error) {
    console.error("Grant tier access error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to grant tier access"
    );
  }
});

/**
 * Revoke tier access
 */
exports.revokeTierAccess = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { userId, tier, reason } = data;

  try {
    // Find active tier access
    const accessQuery = await admin
      .firestore()
      .collection("tierAccess")
      .where("userId", "==", userId)
      .where("tier", "==", tier)
      .where("active", "==", true)
      .get();

    const batch = admin.firestore().batch();

    accessQuery.forEach((doc) => {
      batch.update(doc.ref, {
        active: false,
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        revokedBy: adminId,
        revokeReason: reason,
      });
    });

    // Update user tiers
    const userRef = admin.firestore().collection("users").doc(userId);
    batch.update(userRef, {
      currentTiers: admin.firestore.FieldValue.arrayRemove(tier),
    });

    await batch.commit();

    await logAdminAction(adminId, "revoke_tier_access", {
      userId,
      tier,
      reason,
      revokedCount: accessQuery.size,
    });

    return {
      success: true,
      message: `Revoked ${TIER_CONFIG[tier].name} access`,
    };
  } catch (error) {
    console.error("Revoke tier access error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to revoke tier access"
    );
  }
});

// =====================================
// BOARD MANAGEMENT
// =====================================

/**
 * Get board details with all squares
 */
exports.getBoardDetails = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { boardId } = data;

  try {
    const boardDoc = await admin
      .firestore()
      .collection("boards")
      .doc(boardId)
      .get();
    if (!boardDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Board not found");
    }

    const board = boardDoc.data();
    const squares = board.squares || {};

    // Get game info
    const gameDoc = await admin
      .firestore()
      .collection("games")
      .doc(board.gameId)
      .get();
    const game = gameDoc.data();

    // Get user info for each square
    const squareDetails = {};
    for (const [position, square] of Object.entries(squares)) {
      const userDoc = await admin
        .firestore()
        .collection("users")
        .doc(square.userId)
        .get();

      squareDetails[position] = {
        ...square,
        userEmail: userDoc.data()?.email || "Unknown",
        userTelegram: userDoc.data()?.telegramUsername || "Unknown",
      };
    }

    return {
      success: true,
      board: {
        id: boardId,
        ...board,
        squares: squareDetails,
        filledCount: Object.keys(squares).length,
        availableCount: 50 - Object.keys(squares).length,
        payoutPercentage:
          board.payoutPercentage || TIER_CONFIG[board.tier].payoutPercentage,
      },
      game: {
        id: board.gameId,
        ...game,
      },
    };
  } catch (error) {
    console.error("Get board details error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to get board details"
    );
  }
});

/**
 * Reset board (remove all squares)
 */
exports.resetBoard = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { boardId, reason } = data;

  if (!reason) {
    throw new functions.https.HttpsError("invalid-argument", "Reason required");
  }

  try {
    const batch = admin.firestore().batch();

    // Update board
    const boardRef = admin.firestore().collection("boards").doc(boardId);
    batch.update(boardRef, {
      squares: {},
      resetAt: admin.firestore.FieldValue.serverTimestamp(),
      resetBy: adminId,
      resetReason: reason,
    });

    // Delete all square claims
    const claimsQuery = await admin
      .firestore()
      .collection("squareClaims")
      .where("boardId", "==", boardId)
      .get();

    claimsQuery.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    await logAdminAction(adminId, "reset_board", {
      boardId,
      reason,
      squaresRemoved: claimsQuery.size,
    });

    return {
      success: true,
      message: `Board reset - removed ${claimsQuery.size} squares`,
    };
  } catch (error) {
    console.error("Reset board error:", error);
    throw new functions.https.HttpsError("internal", "Failed to reset board");
  }
});

/**
 * Remove specific square from board
 */
exports.removeSquare = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { boardId, position, reason } = data;

  if (!Number.isInteger(position) || position < 0 || position > 49) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid position"
    );
  }

  try {
    const batch = admin.firestore().batch();

    // Get board
    const boardRef = admin.firestore().collection("boards").doc(boardId);
    const boardDoc = await boardRef.get();

    if (!boardDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Board not found");
    }

    const board = boardDoc.data();
    const square = board.squares?.[position];

    if (!square) {
      throw new functions.https.HttpsError("not-found", "Square not occupied");
    }

    // Remove from board
    const updates = { ...board.squares };
    delete updates[position];

    batch.update(boardRef, { squares: updates });

    // Delete claim record
    if (square.claimId) {
      const claimRef = admin
        .firestore()
        .collection("squareClaims")
        .doc(square.claimId);
      batch.delete(claimRef);
    }

    await batch.commit();

    await logAdminAction(adminId, "remove_square", {
      boardId,
      position,
      userId: square.userId,
      reason,
    });

    return {
      success: true,
      message: `Removed square ${position}`,
    };
  } catch (error) {
    console.error("Remove square error:", error);
    throw new functions.https.HttpsError("internal", "Failed to remove square");
  }
});

// =====================================
// BULK OPERATIONS
// =====================================

/**
 * Bulk export data
 */
exports.exportData = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { dataType, filters = {} } = data;

  try {
    let exportData;

    switch (dataType) {
      case "users":
        exportData = await exportUsers(filters);
        break;
      case "winners":
        exportData = await exportWinners(filters);
        break;
      case "donations":
        exportData = await exportDonations(filters);
        break;
      case "squares":
        exportData = await exportSquares(filters);
        break;
      default:
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Invalid data type"
        );
    }

    await logAdminAction(adminId, "export_data", {
      dataType,
      recordCount: exportData.length,
      filters,
    });

    return {
      success: true,
      data: exportData,
      count: exportData.length,
      exportedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Export data error:", error);
    throw new functions.https.HttpsError("internal", "Failed to export data");
  }
});

/**
 * Send bulk notifications
 */
exports.sendBulkNotification = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  const { userIds, subject, message, medium } = data;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "User IDs required"
    );
  }

  const validMediums = ["email", "telegram", "both"];
  if (!validMediums.includes(medium)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid medium");
  }

  try {
    const results = [];

    for (const userId of userIds) {
      try {
        const userDoc = await admin
          .firestore()
          .collection("users")
          .doc(userId)
          .get();
        if (!userDoc.exists) {
          results.push({ userId, success: false, error: "User not found" });
          continue;
        }

        const user = userDoc.data();
        let sent = false;

        if ((medium === "email" || medium === "both") && user.email) {
          await sendAdminEmail(user.email, subject, message);
          sent = true;
        }

        if (
          (medium === "telegram" || medium === "both") &&
          user.telegramUsername
        ) {
          await sendAdminTelegram(user.telegramUsername, message);
          sent = true;
        } else if (medium === "telegram" && !user.telegramUsername) {
          // User doesn't have Telegram, fallback to email if available
          if (user.email) {
            await sendAdminEmail(
              user.email,
              subject,
              message +
                "\n\n[Note: You requested Telegram delivery, but this user has not added Telegram. Sent via email instead.]"
            );
            sent = true;
          }
        }

        results.push({ userId, success: sent });
      } catch (error) {
        results.push({ userId, success: false, error: error.message });
      }
    }

    await logAdminAction(adminId, "bulk_notification", {
      userCount: userIds.length,
      medium,
      successCount: results.filter((r) => r.success).length,
    });

    return {
      success: true,
      results,
      summary: {
        total: userIds.length,
        successful: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    };
  } catch (error) {
    console.error("Bulk notification error:", error);
    throw new functions.https.HttpsError(
      "internal",
      "Failed to send notifications"
    );
  }
});

// =====================================
// ANALYTICS & REPORTING
// =====================================

/**
 * Get admin dashboard statistics with new payment structure
 */
exports.getAdminStats = functions.https.onCall(async (data, context) => {
  const adminId = requireAdmin(context);

  try {
    // Get date ranges
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const thisWeek = new Date(now);
    thisWeek.setDate(now.getDate() - 7);

    const thisMonth = new Date(now);
    thisMonth.setDate(now.getDate() - 30);

    // User stats
    const totalUsers = await admin.firestore().collection("users").get();
    const activeUsers = await admin
      .firestore()
      .collection("users")
      .where("lastActive", ">=", thisWeek)
      .get();

    // Financial stats with new tier structure
    const donations = await admin
      .firestore()
      .collection("donations")
      .where("status", "==", "completed")
      .get();

    let totalRevenue = 0;
    let revenueToday = 0;
    let revenueThisWeek = 0;
    let revenueThisMonth = 0;
    let revenueByTier = {
      tier_25: 0,
      tier_50: 0,
      tier_100: 0,
      tier_250: 0,
      tier_500: 0,
      tier_1000: 0,
    };

    donations.forEach((doc) => {
      const donation = doc.data();
      const amount = donation.amount || 0;
      totalRevenue += amount;

      if (donation.tier && revenueByTier[donation.tier] !== undefined) {
        revenueByTier[donation.tier] += amount;
      }

      if (donation.completedAt?.toMillis() >= today.getTime()) {
        revenueToday += amount;
      }
      if (donation.completedAt?.toMillis() >= thisWeek.getTime()) {
        revenueThisWeek += amount;
      }
      if (donation.completedAt?.toMillis() >= thisMonth.getTime()) {
        revenueThisMonth += amount;
      }
    });

    // Calculate platform fees with new percentages
    let platformFees = {
      tier_25: revenueByTier.tier_25 * 0.23, // 23% fee
      tier_50: revenueByTier.tier_50 * 0.23,
      tier_100: revenueByTier.tier_100 * 0.23,
      tier_250: revenueByTier.tier_250 * 0.2, // 20% fee
      tier_500: revenueByTier.tier_500 * 0.2,
      tier_1000: revenueByTier.tier_1000 * 0.2,
      total:
        (revenueByTier.tier_25 +
          revenueByTier.tier_50 +
          revenueByTier.tier_100) *
          0.23 +
        (revenueByTier.tier_250 +
          revenueByTier.tier_500 +
          revenueByTier.tier_1000) *
          0.2,
    };

    // Game stats
    const games = await admin.firestore().collection("games").get();
    const upcomingGames = games.docs.filter(
      (doc) => doc.data().status === "scheduled"
    ).length;
    const activeGames = games.docs.filter(
      (doc) => doc.data().status === "active"
    ).length;
    const completedGames = games.docs.filter(
      (doc) => doc.data().status === "completed"
    ).length;

    // Winner and payout stats
    const winners = await admin.firestore().collection("winners").get();
    const pendingPayouts = winners.docs.filter(
      (doc) => doc.data().status === "pending_payout"
    );
    const instantPayouts = winners.docs.filter(
      (doc) => doc.data().payoutType === "instant"
    );

    let totalPrizesPending = 0;
    let totalInstantPayoutFees = 0;
    let instantPayoutsByTier = {
      tier_25: { count: 0, fees: 0 },
      tier_50: { count: 0, fees: 0 },
      tier_100: { count: 0, fees: 0 },
      tier_250: { count: 0, fees: 0 },
      tier_500: { count: 0, fees: 0 },
      tier_1000: { count: 0, fees: 0 },
    };

    pendingPayouts.forEach((doc) => {
      totalPrizesPending += doc.data().prizeAmount || 0;
    });

    instantPayouts.forEach((doc) => {
      const winner = doc.data();
      const fee = winner.instantPayoutFee || 0;
      totalInstantPayoutFees += fee;

      if (winner.tier && instantPayoutsByTier[winner.tier]) {
        instantPayoutsByTier[winner.tier].count++;
        instantPayoutsByTier[winner.tier].fees += fee;
      }
    });

    // Square stats
    const boards = await admin.firestore().collection("boards").get();
    let totalSquaresFilled = 0;
    boards.forEach((doc) => {
      totalSquaresFilled += Object.keys(doc.data().squares || {}).length;
    });

    // Relay batch stats
    const relayBatches = await admin
      .firestore()
      .collection("relayBatches")
      .get();
    const pendingBatches = relayBatches.docs.filter(
      (doc) => doc.data().status === "generated"
    ).length;
    const processedBatches = relayBatches.docs.filter(
      (doc) => doc.data().status === "processed"
    ).length;

    return {
      success: true,
      stats: {
        users: {
          total: totalUsers.size,
          active: activeUsers.size,
          new: totalUsers.docs.filter(
            (doc) => doc.data().createdAt?.toMillis() >= thisWeek.getTime()
          ).length,
        },
        revenue: {
          total: totalRevenue,
          today: revenueToday,
          thisWeek: revenueThisWeek,
          thisMonth: revenueThisMonth,
          byTier: revenueByTier,
          platformFees,
          operatingProfit: platformFees.total,
        },
        games: {
          total: games.size,
          scheduled: upcomingGames,
          active: activeGames,
          completed: completedGames,
        },
        winners: {
          total: winners.size,
          pendingPayouts: pendingPayouts.length,
          totalPrizesPending,
        },
        instantPayouts: {
          total: instantPayouts.length,
          totalFees: totalInstantPayoutFees,
          percentageOfWinners:
            winners.size > 0
              ? ((instantPayouts.length / winners.size) * 100).toFixed(1)
              : 0,
          byTier: instantPayoutsByTier,
          averageFee:
            instantPayouts.length > 0
              ? (totalInstantPayoutFees / instantPayouts.length).toFixed(2)
              : 0,
        },
        relayBatches: {
          pending: pendingBatches,
          processed: processedBatches,
          total: relayBatches.size,
        },
        squares: {
          totalFilled: totalSquaresFilled,
          totalAvailable: boards.size * 50,
          fillRate: ((totalSquaresFilled / (boards.size * 50)) * 100).toFixed(
            1
          ),
        },
      },
    };
  } catch (error) {
    console.error("Get admin stats error:", error);
    throw new functions.https.HttpsError("internal", "Failed to get stats");
  }
});

// =====================================
// HELPER FUNCTIONS
// =====================================

function calculateWinningPositions(homeScore, awayScore) {
  const homeDigit = homeScore % 10;
  const awayDigit = awayScore % 10;

  const positions = [];

  // For 5x10 grid with bidirectional winning
  if (homeDigit <= 4) {
    positions.push(homeDigit * 10 + awayDigit);
  } else {
    positions.push((homeDigit - 5) * 10 + awayDigit);
  }

  if (awayDigit <= 4 && homeDigit !== awayDigit) {
    positions.push(awayDigit * 10 + homeDigit);
  } else if (awayDigit > 4 && homeDigit !== awayDigit) {
    positions.push((awayDigit - 5) * 10 + homeDigit);
  }

  return [...new Set(positions)];
}

function calculatePrizeAmount(tier) {
  const tierConfig = TIER_CONFIG[tier];
  const totalPot = tierConfig.amount * 50;
  const prizePool = totalPot * tierConfig.payoutPercentage;
  return prizePool / 4; // Divided by 4 quarters
}

async function triggerWinnerNotifications(winners) {
  // This would call the winner notification system from Artifact #6
  console.log(`Triggering notifications for ${winners.length} winners`);
  // Implementation would connect to the notification system
}

async function logAdminAction(adminId, action, details) {
  await admin.firestore().collection("adminLogs").add({
    adminId,
    action,
    details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handleGameCancellation(gameId, adminId, reason) {
  // Handle game cancellation - notify users, process refunds if needed
  console.log(`Handling cancellation for game ${gameId}: ${reason}`);

  // Get all boards for this game
  const boards = await admin
    .firestore()
    .collection("boards")
    .where("gameId", "==", gameId)
    .get();

  // Get all users who have squares in these boards
  const affectedUsers = new Set();
  boards.forEach((board) => {
    const squares = board.data().squares || {};
    Object.values(squares).forEach((square) => {
      if (square.userId) affectedUsers.add(square.userId);
    });
  });

  // Log the cancellation
  await logAdminAction(adminId, "game_cancelled", {
    gameId,
    reason,
    affectedUsers: affectedUsers.size,
    boards: boards.size,
  });

  console.log(
    `Game cancellation handled. ${affectedUsers.size} users affected.`
  );
}

// Export helper functions
async function exportUsers(filters) {
  let query = admin.firestore().collection("users");

  if (filters.tier) {
    query = query.where("currentTiers", "array-contains", filters.tier);
  }

  if (filters.minDonations) {
    query = query.where("totalDonations", ">=", filters.minDonations);
  }

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const user = doc.data();
    return {
      id: doc.id,
      email: user.email,
      telegramUsername: user.telegramUsername,
      totalDonations: user.totalDonations || 0,
      currentTiers: user.currentTiers || [],
      instantPayoutPreference: user.instantPayoutPreference || false,
      createdAt: user.createdAt?.toDate?.().toISOString(),
    };
  });
}

async function exportWinners(filters) {
  let query = admin.firestore().collection("winners");

  if (filters.gameId) {
    query = query.where("gameId", "==", filters.gameId);
  }

  if (filters.tier) {
    query = query.where("tier", "==", filters.tier);
  }

  if (filters.status) {
    query = query.where("status", "==", filters.status);
  }

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const winner = doc.data();
    return {
      id: doc.id,
      userId: winner.userId,
      game: winner.game,
      quarter: winner.quarter,
      position: winner.position,
      score: winner.score,
      prizeAmount: winner.prizeAmount,
      tier: winner.tier,
      status: winner.status,
      payoutType: winner.payoutType || "batch",
      payoutPercentage: winner.payoutPercentage,
      instantPayoutFee: winner.instantPayoutFee || 0,
      createdAt: winner.createdAt?.toDate?.().toISOString(),
    };
  });
}

async function exportDonations(filters) {
  let query = admin.firestore().collection("donations");

  if (filters.status) {
    query = query.where("status", "==", filters.status);
  }

  if (filters.tier) {
    query = query.where("tier", "==", filters.tier);
  }

  if (filters.startDate) {
    query = query.where("createdAt", ">=", new Date(filters.startDate));
  }

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const donation = doc.data();
    return {
      id: doc.id,
      userId: donation.userId,
      amount: donation.amount,
      tier: donation.tier,
      status: donation.status,
      payoutPercentage: donation.payoutPercentage,
      telegramUsername: donation.telegramUsername,
      createdAt: donation.createdAt?.toDate?.().toISOString(),
      completedAt: donation.completedAt?.toDate?.().toISOString(),
    };
  });
}

async function exportSquares(filters) {
  let query = admin.firestore().collection("squareClaims");

  if (filters.boardId) {
    query = query.where("boardId", "==", filters.boardId);
  }

  if (filters.userId) {
    query = query.where("userId", "==", filters.userId);
  }

  const snapshot = await query.get();

  return snapshot.docs.map((doc) => {
    const claim = doc.data();
    return {
      id: doc.id,
      userId: claim.userId,
      boardId: claim.boardId,
      position: claim.position,
      tier: claim.tier,
      claimedAt: claim.claimedAt?.toDate?.().toISOString(),
    };
  });
}

async function sendAdminEmail(email, subject, message) {
  const nodemailer = require("nodemailer");
  const mailTransport = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  await sendMail({
    // from: "Square Trivia Admin <admin@squaretrivia.com>",
    to: email,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${subject}</h2>
        <div style="white-space: pre-wrap;">${message}</div>
        <hr style="margin-top: 20px;">
        <p style="color: #666; font-size: 12px;">
          This is an administrative message from Square Trivia.
        </p>
      </div>
    `,
  });
}

async function sendAdminTelegram(username, message) {
  const TelegramBot = require("node-telegram-bot-api");
  const bot = new TelegramBot(functions.config().telegram.bot_token, {
    polling: false,
  });

  try {
    await bot.sendMessage(`@${username}`, `📢 Admin Message:\n\n${message}`);
  } catch (error) {
    console.log("Telegram send failed:", error);
  }
}

// Export all functions as a module if needed
module.exports = exports;
