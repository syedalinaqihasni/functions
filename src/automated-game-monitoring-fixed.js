// Square Trivia - Automated Game Monitoring System
// Handles live score updates, API integration, and fallback mechanisms
require("dotenv").config();

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const { logger } = require("firebase-functions");
// const db = admin.firestore();

const {
  SPORTS_CONFIG,
  GAME_CONFIG,
  API_CONFIG,
  ERROR_MESSAGES,
  FEATURE_FLAGS,
  VALIDATION_RULES,
  // DUMMY_GAMES,
} = require("./constants-configuration-fixed");

const {
  getTimestamp,
  getNow,
  retryOperation,
  logError,
  safeTransaction,
  measurePerformance,
  createError,
} = require("./utility-functions-fixed.js");

const { processQuarterWinners } = require("./grid-system-complete.js");

// =====================================
// API-SPORTS SERVICE
// =====================================

class ApiSportsService {
  constructor() {
    this.apiKey =
      functions.config()?.apisports?.key || process.env.APISPORTS_KEY;
    this.requestCount = 0;
    this.lastRequestTime = null;
  }

  /**
   * Get API headers
   */
  getHeaders(sport) {
    const config = SPORTS_CONFIG[sport];
    return {
      "x-rapidapi-key": this.apiKey,
      "x-rapidapi-host": config.apiHost,
    };
  }

  /**
   * Make API request with retry logic
   */
  async makeRequest(
    url,
    headers,
    retries = API_CONFIG.API_SPORTS.RETRY_ATTEMPTS
  ) {
    return await retryOperation(
      async () => {
        // Log API call in debug mode
        if (FEATURE_FLAGS.LOG_API_CALLS) {
          console.log(`API-Sports request: ${url}`);
        }

        const response = await axios.get(url, {
          headers,
          timeout: API_CONFIG.API_SPORTS.TIMEOUT,
        });

        this.requestCount++;
        this.lastRequestTime = Date.now();

        if (response.data.errors?.length > 0) {
          throw new Error(
            `API-Sports error: ${JSON.stringify(response.data.errors)}`
          );
        }

        return response.data;
      },
      retries,
      API_CONFIG.API_SPORTS.RETRY_DELAY
    );
  }

  /**
   * Fetch game score from API-Sports
   */
  /**
   * Fetch game score from API-Sports
   */
  /**
   * Fetch game score from API-Sports
   */
  async fetchGameScore(gameId, sport, week = 1) {
    logger.info("GAME ID: ", { gameId });
    if (!gameId) throw new Error("No gameId provided");

    try {
      let apiGame = null;

      if (sport === "NFL") {
        // --- NFL ---
        const url = `https://v1.american-football.api-sports.io/games`;
        const response = await axios.get(url, {
          params: { id: gameId },
          headers: { "x-apisports-key": process.env.REACT_APP_APISPORTS_KEY },
        });

        apiGame = response.data?.response?.[0] || null;

        if (apiGame?.game) {
          // Compute currentQuarter
          let currentQuarter = 1;
          const short = apiGame.game.status?.short;
          const period = apiGame.game.periods?.current;

          if (typeof period === "number") currentQuarter = period;
          else if (short === "HT") currentQuarter = 2;
          else if (short === "FT") currentQuarter = 4;

          if (currentQuarter > 4) currentQuarter = "ot";
          apiGame.currentQuarter = currentQuarter;
        }
      } else if (sport === "CFB") {
        // --- CFB ---
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary`;
        const response = await axios.get(url, {
          params: { event: gameId },
          headers: { accept: "application/json" },
        });

        const competition = response.data.header?.competitions?.[0];
        if (competition) {
          const statusObj = competition.status?.type;

          // Convert ESPN state to short code for parseGameData
          const statusShort = (() => {
            const s = statusObj?.state;
            if (s === "pre") return "NS";
            else if (s === "in")
              return `Q${Math.min(statusObj.period || 1, 4)}`;
            else if (s === "post") return "FT";
            else if (s?.toLowerCase().includes("cancel")) return "CANC";
            return "NS";
          })();

          const venue = competition.venue || {};
          const home = competition.competitors.find(
            (t) => t.homeAway === "home"
          );
          const away = competition.competitors.find(
            (t) => t.homeAway === "away"
          );

          const seasonType =
            competition.season?.type || response.data.header?.season?.type;
          const stage = seasonType === 2 ? "Regular Season" : "Post Season";
          const weekVal =
            seasonType === 2
              ? response.data.header?.week
              : response.data.header?.week?.text || "Championship";

          apiGame = {
            game: {
              id: gameId,
              stage,
              week: weekVal,
              date: {
                timezone: "UTC",
                date: competition.date.split("T")[0],
                time: competition.date.split("T")[1].slice(0, 5),
                timestamp: Math.floor(
                  new Date(competition.date).getTime() / 1000
                ),
              },
              venue: {
                name: venue.fullName || null,
                city: venue.address?.city || null,
              },
              status: { short: statusShort },
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
                quarter_1: home.linescores?.[0]?.value ?? 0,
                quarter_2: home.linescores?.[1]?.value ?? 0,
                quarter_3: home.linescores?.[2]?.value ?? 0,
                quarter_4: home.linescores?.[3]?.value ?? 0,
                overtime: home.linescores?.[4]?.value ?? null,
                total: Number(home.score) || 0,
              },
              away: {
                quarter_1: away.linescores?.[0]?.value ?? 0,
                quarter_2: away.linescores?.[1]?.value ?? 0,
                quarter_3: away.linescores?.[2]?.value ?? 0,
                quarter_4: away.linescores?.[3]?.value ?? 0,
                overtime: away.linescores?.[4]?.value ?? null,
                total: Number(away.score) || 0,
              },
            },
            currentQuarter: (() => {
              const scored = [
                home.linescores?.[0]?.value,
                home.linescores?.[1]?.value,
                home.linescores?.[2]?.value,
                home.linescores?.[3]?.value,
              ].filter((v) => v !== null && v !== undefined).length;
              if (scored > 0) return scored;
              if (statusObj?.state === "in")
                return Math.min(statusObj.period || 1, 4);
              if (statusObj?.state === "post") return 4;
              return 1;
            })(),
          };
        }
      }

      // Fallback if no game found
      if (!apiGame)
        return {
          apiSportsId: gameId,
          status: "unknown",
          currentQuarter: 1,
          quarterScores: {},
          totalScore: { home: 0, away: 0 },
          teams: { home: "", away: "" },
          startTime: null,
          lastUpdate: new Date().toISOString(),
          _notFound: true,
        };
      logger.info("MY GAME 1", { game });
      return this.parseGameData(apiGame, sport);
    } catch (error) {
      console.error(
        `[fetchGameScore] Error for gameId: ${gameId}, sport: ${sport}`,
        error
      );
      throw error;
    }
  }

  /**
   * Parse API response into standard format
   */
  async parseGameData(apiGame, sport) {
    const game = apiGame?.game;
    const teams = apiGame?.teams;
    const scores = apiGame?.scores;

    logger.info("MY GAME", { game });

    // Map status short codes to our standard
    const statusMap = {
      NS: "scheduled",
      Q1: "active",
      Q2: "active",
      Q3: "active",
      Q4: "active",
      OT: "active",
      HT: "active",
      FT: "completed",
      AOT: "completed",
      PST: "cancelled",
      CANC: "cancelled",
      SUSP: "cancelled",
    };
    const statusShort = game?.status?.short;
    let gameStatus = statusMap[statusShort] || "scheduled";

    const db = admin.firestore();
    const snapshot = await db
      .collection("games")
      .where("externalGameId", "==", String(game?.id))
      .get();

    if (!snapshot.empty) {
      const activeGameData = snapshot.docs[0].data();
      if (activeGameData?.status === "active" && gameStatus === "scheduled") {
        gameStatus = "active";
      }
    }

    // Parse quarter scores
    const quarterScores = {};
    let scoredQuarters = 0;
    ["quarter_1", "quarter_2", "quarter_3", "quarter_4", "overtime"].forEach(
      (q, idx) => {
        if (scores?.home?.[q] !== null && scores?.home?.[q] !== undefined) {
          const key = q === "overtime" ? "ot" : `q${idx + 1}`;
          quarterScores[key] = {
            home: scores.home[q] ?? null,
            away: scores.away[q] ?? null,
          };
          scoredQuarters++;
        }
      }
    );

    // Current quarter based on scores first, then status mapping
    let currentQuarter =
      scoredQuarters > 0
        ? scoredQuarters
        : (() => {
            if (statusShort === "Q1") return 1;
            if (statusShort === "Q2" || statusShort === "HT") return 2;
            if (statusShort === "Q3") return 3;
            if (["Q4", "OT", "AOT", "FT"].includes(statusShort)) return 4;
            return 1;
          })();

    return {
      apiSportsId: game?.id,
      status: gameStatus,
      currentQuarter,
      quarterScores,
      totalScore: {
        home: scores?.home?.total ?? 0,
        away: scores?.away?.total ?? 0,
      },
      teams: {
        home: teams?.home?.name ?? "",
        away: teams?.away?.name ?? "",
      },
      startTime:
        game?.date?.date && game?.date?.time
          ? new Date(`${game.date.date}T${game.date.time}:00Z`)
          : null,
      lastUpdate: new Date().toISOString(),
      stage: game?.stage || null,
      week: game?.week || null,
    };
  }

  /**
   * Get mock data for testing
   */
  getMockGameData(apiSportsId, sport) {
    return {
      apiSportsId,
      status: "active",
      currentPeriod: 2,
      quarterScores: {
        q1: { home: 7, away: 3 },
        q2: { home: 14, away: 10 },
        q3: { home: null, away: null },
        q4: { home: null, away: null },
      },
      totalScore: { home: 21, away: 13 },
      teams: { home: "Test Home", away: "Test Away" },
      startTime: new Date(),
      lastUpdate: new Date().toISOString(),
    };
  }

  /**
   * Check API health
   */
  async checkHealth() {
    try {
      const url = "https://v1.american-football.api-sports.io/status";
      const headers = this.getHeaders("NFL");
      const response = await axios.get(url, { headers, timeout: 5000 });

      return {
        healthy: true,
        requestsUsed: this.requestCount,
        lastRequest: this.lastRequestTime,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  }
}

// Create singleton instance
const apiSportsService = new ApiSportsService();

// =====================================
// GAME MONITORING ENGINE
// =====================================

/**
 * Monitor all active games (runs every minute)
 */
const monitorLiveGames = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    // Skip if in maintenance mode
    if (FEATURE_FLAGS.MAINTENANCE_MODE) {
      console.log("Skipping game monitoring - maintenance mode");
      return;
    }

    console.log("Starting live game monitoring cycle...");
    const startTime = Date.now();

    try {
      // Get all active games
      const db = admin.firestore();
      const activeGames = await db
        .collection("games")
        .where("status", "==", GAME_CONFIG.STATUS.ACTIVE)
        .get();

      console.log(`Found ${activeGames.size} active games to monitor`);

      if (activeGames.empty) {
        return;
      }

      // Process games in parallel (but limit concurrency)
      const gamePromises = [];
      const MAX_CONCURRENT = 5;

      for (let i = 0; i < activeGames.docs.length; i += MAX_CONCURRENT) {
        const batch = activeGames.docs.slice(i, i + MAX_CONCURRENT);
        const batchPromises = batch.map((gameDoc) =>
          monitorSingleGame(db, gameDoc).catch((error) => {
            console.error("RAW monitorSingleGame error:", error);

            logError(error, {
              context: "monitorSingleGame",
              gameId: gameDoc?.id,
            });
            return null;
          })
        );
        const results = await Promise.all(batchPromises);
        gamePromises.push(...results);
      }

      const duration = Date.now() - startTime;
      console.log(`Game monitoring completed in ${duration}ms`);

      // Log summary
      const successful = gamePromises.filter((r) => r?.success).length;
      const failed = gamePromises.length - successful;

      // await db.collection("systemLogs").add({
      //   type: "game_monitoring",
      //   timestamp: getTimestamp(),
      //   duration,
      //   gamesProcessed: activeGames.size,
      //   successful,
      //   failed,
      // });
    } catch (error) {
      logError(error, { context: "monitorLiveGames" });

      // Send admin alert
      await sendAdminAlert({
        type: "monitoring_failure",
        message: "Game monitoring cycle failed",
        error: error.message,
      });
    }
  });

/**
 * Monitor a single game
 */
async function monitorSingleGame(db, gameDoc) {
  const gameId = gameDoc?.id;
  const game = gameDoc.data();
  logger.info(`[monitorSingleGame] Starting monitoring for gameId=${gameId}`);
  logger.debug(
    `[monitorSingleGame] Game doc snapshot: ${JSON.stringify(game, null, 2)}`
  );
  console.log(
    `Monitoring game ${gameId}: ${game.teams.away} @ ${game.teams.home}`
  );
  if (!game.externalGameId) {
    logger.warn(
      `[monitorSingleGame] Game ${gameId} missing externalGameId - skipping`
    );
    return { success: false, reason: "missing_api_id" };
  }
  try {
    // Fetch current scores with performance tracking
    logger.info(
      `[monitorSingleGame] Fetching scores for gameId=${gameId}, externalGameId=${game.externalGameId}, sport=${game.sport}`
    );
    const fetchScores = measurePerformance(
      () =>
        apiSportsService.fetchGameScore(
          game.externalGameId,
          game.sport,
          game?.week
        ),
      "fetchGameScore"
    );
    const liveData = await fetchScores();
    logger.info(
      `[monitorSingleGame] Received live data for gameId=${gameId}: status=${liveData.status}`
    );
    logger.info("Live Data", { liveData });

    const getCurrentQuarter = (processedQuarters, fallback = 1) => {
      if (!processedQuarters) return fallback;

      if (processedQuarters.q4) return 4;
      if (processedQuarters.q3) return 4;
      if (processedQuarters.q2) return 3;
      if (processedQuarters.q1) return 2;

      return fallback;
    };

    // Update game with latest data
    const updates = {
      lastApiCheck: getTimestamp(),
      lastApiStatus: game?.status?.short ?? null,
      apiCheckCount: admin.firestore.FieldValue.increment(1),
      currentQuarter: liveData.currentQuarter ?? 1,
    };
    // Check if game status changed
    if (liveData.status !== game.status) {
      logger.info(
        `[monitorSingleGame] Game ${gameId} status changed: ${game.status} → ${liveData.status}`
      );
      updates.status = liveData.status;
      if (liveData.status === GAME_CONFIG.STATUS.COMPLETED) {
        logger.info(
          `[monitorSingleGame] Game ${gameId} completed. Final score: ${liveData.totalScore.home}-${liveData.totalScore.away}`
        );
        updates.completedAt = getTimestamp();
        updates.finalScore = liveData.totalScore;
      }
    }
    // Process each quarter
    const quarters = ["q1", "q2", "q3", "q4"];
    if (liveData.quarterScores.ot) {
      quarters.push("ot");
    }
    let winnersProcessed = 0;
    for (const quarter of quarters) {
      const quarterScore = liveData.quarterScores[quarter];
      // Skip if no score yet
      if (
        !quarterScore ||
        quarterScore.home === null ||
        quarterScore.away === null
      ) {
        logger.debug(
          `[monitorSingleGame] Skipping ${quarter} for game ${gameId} - no score yet`
        );
        continue;
      }
      // Skip if already processed
      if (game.processedQuarters?.[quarter]) {
        logger.debug(
          `[monitorSingleGame] Skipping ${quarter} for game ${gameId} - already processed`
        );
        continue;
      }
      logger.info(
        `[monitorSingleGame] Processing ${quarter} for game ${gameId}: ${quarterScore.home}-${quarterScore.away}`
      );
      try {
        // const winners = await processQuarterWinners(
        //   db,
        //   gameId,
        //   quarter,
        //   quarterScore,
        //   game
        // );
        // logger.info(
        //   `[monitorSingleGame] Processing ${winners.length} winners for game ${gameId}, quarter=${quarter}  winners=${winners}`
        // );
        // Mark quarter as processed
        // updates[`quarterScores.${quarter}.processed`] = true;
        updates[`quarterScores.${quarter}.home`] = quarterScore.home;
        updates[`quarterScores.${quarter}.away`] = quarterScore.away;
        // winnersProcessed += winners.length;
        logger.info(
          `[monitorSingleGame] Processed ${quarter} for game ${gameId}, winners`
        );
        // Send notifications (async - don't wait)
        // notifyWinners(db, winners).catch((error) => {
        //   logger.error(
        //     `[monitorSingleGame] Error sending notifications for game ${gameId}, quarter=${quarter}`,
        //     { error }
        //   );
        //   logError(error, { context: "notifyWinners", gameId, quarter });
        // });
      } catch (error) {
        logger.error(
          `[monitorSingleGame] Error processing winners for game ${gameId}, quarter=${quarter}`,
          { error }
        );
        logError(error, { context: "processQuarterWinners", gameId, quarter });
      }
    }
    // Save all updates
    logger.info(
      `[monitorSingleGame] Updating Firestore for gameId=${gameId}`,
      updates
    );
    await gameDoc.ref.update(updates);
    return {
      success: true,
      gameId,
      winnersProcessed,
      status: liveData.status,
    };
  } catch (error) {
    logger.error(`[monitorSingleGame] Error monitoring game ${gameId}`, {
      error,
      externalGameId: game.externalGameId,
    });
    logError(error, {
      context: "monitorSingleGame",
      gameId,
      apiSportsId: game.externalGameId,
    });
    // Update game with error status
    await gameDoc.ref.update({
      lastApiCheck: getTimestamp(),
      lastApiError: error.message,
      apiErrorCount: admin.firestore.FieldValue.increment(1),
    });
    return {
      success: false,
      gameId,
      error: error.message,
    };
  }
}

// =====================================
// MANUAL SCORE ENTRY
// =====================================

/**
 * Manual score update by admin
 */
const manualScoreUpdate = functions.https.onCall(async (data, context) => {
  // Verify admin
  if (!context.auth?.token?.admin) {
    throw createError("permission", ERROR_MESSAGES.ADMIN_ONLY);
  }

  const { gameId, quarter, homeScore, awayScore, markAsComplete } = data;

  // Validate input
  if (
    !gameId ||
    !quarter ||
    homeScore === undefined ||
    awayScore === undefined
  ) {
    throw createError("validation", "Missing required fields");
  }

  const db = admin.firestore();

  try {
    // Get game
    const gameRef = db.collection("games").doc(gameId);
    const gameDoc = await gameRef.get();

    if (!gameDoc.exists) {
      throw createError("not-found", ERROR_MESSAGES.GAME_NOT_FOUND);
    }

    const game = gameDoc.data();

    // Check if quarter already processed
    if (game.processedQuarters?.[quarter]) {
      throw createError("exists", `Quarter ${quarter} already processed`);
    }

    // Process winners
    const quarterScore = {
      home: parseInt(homeScore),
      away: parseInt(awayScore),
    };

    const winners = await processQuarterWinners(
      db,
      gameId,
      quarter,
      quarterScore,
      game
    );

    // Update game
    const updates = {
      [`scores.${quarter}`]: quarterScore,
      [`processedQuarters.${quarter}`]: true,
      manualScoreEntry: true,
      [`manualScores.${quarter}`]: {
        ...quarterScore,
        enteredBy: context.auth.uid,
        enteredAt: getTimestamp(),
      },
    };

    if (markAsComplete) {
      updates.status = GAME_CONFIG.STATUS.COMPLETED;
      updates.completedAt = getTimestamp();
      updates.finalScore = {
        home: Object.values({ ...game.scores, ...updates })
          .filter((s) => s.home !== undefined)
          .reduce((sum, s) => sum + (s.home || 0), 0),
        away: Object.values({ ...game.scores, ...updates })
          .filter((s) => s.away !== undefined)
          .reduce((sum, s) => sum + (s.away || 0), 0),
      };
    }

    await gameRef.update(updates);

    // Notify winners
    await notifyWinners(db, winners);

    return {
      success: true,
      message: `${quarter} winners processed`,
      winnersCount: winners.length,
      score: `${quarterScore.home}-${quarterScore.away}`,
    };
  } catch (error) {
    logError(error, {
      context: "manualScoreUpdate",
      gameId,
      quarter,
    });
    throw error;
  }
});

// =====================================
// GAME SCHEDULING
// =====================================

/**
 * Auto-activate games at start time
 */
const activateUpcomingGames = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    const db = admin.firestore();
    const now = getNow();

    try {
      // Find games that should be active
      const upcomingGames = await db
        .collection("games")
        .where("status", "==", GAME_CONFIG.STATUS.UPCOMING)
        .where("gameDate", "<=", now)
        .get();

      if (upcomingGames.empty) {
        return;
      }

      console.log(`Activating ${upcomingGames.size} games`);

      const batch = db.batch();

      upcomingGames.forEach((doc) => {
        batch.update(doc.ref, {
          status: GAME_CONFIG.STATUS.ACTIVE,
          actualStartTime: getTimestamp(),
        });
      });

      await batch.commit();

      // Log activation
      await db.collection("systemLogs").add({
        type: "games_activated",
        count: upcomingGames.size,
        timestamp: getTimestamp(),
      });
    } catch (error) {
      logError(error, { context: "activateUpcomingGames" });
    }
  });

// Activate games 7 days earlier
const activateNext7DaysGames = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    const db = admin.firestore();
    const now = getNow();

    // 7 days ahead
    const sevenDaysAhead = new Date(now.toDate()); // if getNow() returns Firestore.Timestamp
    sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7);

    console.log("NOW:", now.toDate());
    console.log("7 DAYS AHEAD:", sevenDaysAhead);

    try {
      // Find upcoming games that start within the next 7 days
      const upcomingGames = await db
        .collection("games")
        .where("status", "==", GAME_CONFIG.STATUS.UPCOMING)
        .where("gameDate", ">=", now)
        .where("gameDate", "<=", sevenDaysAhead)
        .get();

      if (upcomingGames.empty) {
        return;
      }

      console.log(`Activating ${upcomingGames.size} games (within 7 days)`);

      const batch = db.batch();

      upcomingGames.forEach((doc) => {
        console.log(
          "GAME:",
          doc.id,
          doc.data().gameDate.toDate(),
          doc.data().status
        );
        batch.update(doc.ref, {
          status: GAME_CONFIG.STATUS.ACTIVE,
          scheduledActivationTime: getTimestamp(), // optional custom field
        });
      });

      await batch.commit();

      // Log activation
      await db.collection("systemLogs").add({
        type: "games_activated_7days",
        count: upcomingGames.size,
        timestamp: getTimestamp(),
      });
    } catch (error) {
      logError(error, { context: "activateNext7DaysGames" });
    }
  });

/**
 * Check for stuck games
 */
const checkStuckGames = functions.pubsub
  .schedule("every 30 minutes")
  .timeZone("America/Denver")
  .onRun(async (context) => {
    const db = admin.firestore();
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    try {
      // Find games active for too long
      const stuckGames = await db
        .collection("games")
        .where("status", "==", GAME_CONFIG.STATUS.ACTIVE)
        .where(
          "actualStartTime",
          "<",
          admin.firestore.Timestamp.fromDate(fourHoursAgo)
        )
        .get();

      if (!stuckGames.empty) {
        console.warn(`Found ${stuckGames.size} potentially stuck games`);

        const gamesList = stuckGames.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          hoursActive: Math.floor(
            (Date.now() - doc.data().actualStartTime.toDate()) /
              (1000 * 60 * 60)
          ),
        }));

        await sendAdminAlert({
          type: "stuck_games",
          message: `${stuckGames.size} games have been active for over 4 hours`,
          games: gamesList,
        });
      }

      // Check for games with API errors
      const errorGames = await db
        .collection("games")
        .where("status", "==", GAME_CONFIG.STATUS.ACTIVE)
        .where("apiErrorCount", ">", 10)
        .get();

      if (!errorGames.empty) {
        await sendAdminAlert({
          type: "api_errors",
          message: `${errorGames.size} games have excessive API errors`,
          games: errorGames.docs.map((d) => ({
            id: d.id,
            errors: d.data().apiErrorCount,
          })),
        });
      }
    } catch (error) {
      logError(error, { context: "checkStuckGames" });
    }
  });

// =====================================
// NOTIFICATION SYSTEM
// =====================================

/**
 * Send winner notifications (placeholder - full implementation in next artifact)
 */
async function notifyWinners(db, winners) {
  if (winners.length === 0) return;

  console.log(`Queuing notifications for ${winners.length} winners`);

  // Queue notifications for processing
  const batch = db.batch();

  winners.forEach((winner) => {
    const notificationRef = db.collection("notificationQueue").doc();
    batch.set(notificationRef, {
      type: "winner",
      winnerId: winner.id,
      userId: winner.userId,
      priority: "high",
      attempts: 0,
      createdAt: getTimestamp(),
      status: "pending",
    });
  });

  await batch.commit();
}

/**
 * Send admin alerts
 */
async function sendAdminAlert(alert) {
  const db = admin.firestore();

  await db.collection("adminAlerts").add({
    ...alert,
    timestamp: getTimestamp(),
    resolved: false,
    priority: alert.type === "monitoring_failure" ? "critical" : "high", // FIXED: Complete ternary operator
  });

  // In production, also send immediate notification
  console.error("ADMIN ALERT:", alert);
}

// =====================================
// HEALTH MONITORING
// =====================================

/**
 * Monitor API-Sports health
 */
const monitorApiHealth = functions.pubsub
  .schedule("every 15 minutes")
  .onRun(async (context) => {
    try {
      const health = await apiSportsService.checkHealth();

      const db = admin.firestore();
      await db.collection("systemHealth").add({
        service: "api-sports",
        timestamp: getTimestamp(),
        ...health,
      });

      if (!health.healthy) {
        await sendAdminAlert({
          type: "api_unhealthy",
          message: "API-Sports health check failed",
          error: health.error,
        });
      }
    } catch (error) {
      logError(error, { context: "monitorApiHealth" });
    }
  });

// =====================================
// TESTING UTILITIES
// =====================================

/**
 * Test API connection
 */
const testApiConnection = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw createError("permission", ERROR_MESSAGES.ADMIN_ONLY);
  }

  const { apiSportsId, sport } = data;

  try {
    const result = await apiSportsService.fetchGameScore(apiSportsId, sport);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

function validateTelegramUsername(username) {
  // Allow empty/null values
  if (!username || username === "" || username.trim() === "") {
    return { valid: true, value: null, isEmpty: true };
  }

  if (typeof username !== "string") {
    return { valid: false, error: ERROR_MESSAGES.INVALID_TELEGRAM };
  }

  // Remove @ if present and trim
  const cleaned = username.trim().replace(/^@/, "");

  if (!VALIDATION_RULES.TELEGRAM_USERNAME.test("@" + cleaned)) {
    return { valid: false, error: ERROR_MESSAGES.INVALID_TELEGRAM };
  }

  return { valid: true, value: "@" + cleaned, isEmpty: false };
}

/**
 * Force game monitoring for specific game
 */
const forceMonitorGame = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) {
    throw createError("permission", ERROR_MESSAGES.ADMIN_ONLY);
  }

  const { gameId } = data;

  const db = admin.firestore();
  const gameDoc = await db.collection("games").doc(gameId).get();

  if (!gameDoc.exists) {
    throw createError("not-found", ERROR_MESSAGES.GAME_NOT_FOUND);
  }

  const result = await monitorSingleGame(db, gameDoc);

  return result;
});

//  const addTelegramToAccount = functions.https.onCall(async (data, context) => {
//   // data comes from frontend
//   const { userId, telegramUsername } = data;

//   console.log("addTelegramToAccount called", { userId, telegramUsername });

//   // Optional: check authentication
//   if (!context.auth) {
//     throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
//   }

//   // Optional: validate userId matches authenticated user
//   if (context.auth.uid !== userId) {
//     throw new functions.https.HttpsError("permission-denied", "Cannot add Telegram for another user.");
//   }

//   try {
//     // Validate telegram username
//     const validation = validateTelegramUsername(telegramUsername);
//     if (!validation.valid || validation.isEmpty) {
//       throw new functions.https.HttpsError(
//         "invalid-argument",
//         validation.error || "Please enter a valid Telegram username"
//       );
//     }

//     // Update user profile in Firestore
//     const userRef = db.collection("users").doc(userId);
//     await userRef.update({
//       telegramUsername: validation.value,
//       hasTelegram: true,
//       preferredNotificationMethod: "both",
//       updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//     });

//     // Grant Telegram access for active tiers
//     const userDoc = await userRef.get();
//     const userData = userDoc.data();

//     if (userData.currentTiers && userData.currentTiers.length > 0) {
//       for (const tier of userData.currentTiers) {
//         const grantTelegramAccessForTier = functions.httpsCallable("grantTelegramAccessForTier");
//         await grantTelegramAccessForTier({ userId, tier, telegramUsername: validation.value });
//       }
//     }

//     return {
//       success: true,
//       message: "Telegram added successfully! You now have access to all benefits.",
//       benefits: {
//         extraAttempts: 5,
//         instantNotifications: true,
//         communityAccess: true,
//       },
//     };
//   } catch (error) {
//     console.error("Add Telegram error:", error);
//     throw new functions.https.HttpsError("internal", error.message);
//   }
// });

// =====================================
// EXPORTS
// =====================================

module.exports = {
  // Services
  apiSportsService,

  // Functions
  monitorLiveGames,
  manualScoreUpdate,
  activateUpcomingGames,
  checkStuckGames,
  monitorApiHealth,

  // Testing
  testApiConnection,
  forceMonitorGame,
  activateNext7DaysGames,
  // addTelegramToAccount
};
