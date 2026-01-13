// Square Trivia - Grid System & Winner Calculation
// SKILL-BASED implementation with trivia answer time determining winners

// =====================================
// COMMONJS IMPORTS
// =====================================

const admin = require("firebase-admin");
const functions = require("firebase-functions");

// Import from config - using CommonJS
const {
  GAME_CONFIG,
  VALIDATION_RULES,
  ERROR_MESSAGES,
} = require("./constants-configuration-fixed");

// Import utility functions - using CommonJS
const {
  secureRandomInt,
  validateSquarePosition,
  safeTransaction,
  createError,
  getTimestamp,
  getTierById,
  calculatePrizes,
} = require("./utility-functions-fixed");

// Note: Removed non-existent notification function imports
// Notifications will be queued to 'notificationQueue' collection instead

// =====================================
// GRID CONFIGURATION
// =====================================

// Grid layout: 5 rows x 10 columns = 50 squares
const GRID_CONFIG = {
  TOTAL_SQUARES: 50,
  ROWS: 5,
  COLS: 10,

  // Visual mapping for score digits
  ROW_DIGITS: [
    [0, 5], // Row 0: represents digits 0 and 5
    [1, 6], // Row 1: represents digits 1 and 6
    [2, 7], // Row 2: represents digits 2 and 7
    [3, 8], // Row 3: represents digits 3 and 8
    [4, 9], // Row 4: represents digits 4 and 9
  ],

  COL_DIGITS: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

// =====================================
// WINNER CALCULATION ENGINE
// =====================================

/**
 * Calculate winning positions based on final score
 * This is the CORE logic - must be 100% accurate
 */
function calculateWinningPositions(homeScore, awayScore) {
  const homeLastDigit = Math.abs(homeScore) % 10;
  const awayLastDigit = Math.abs(awayScore) % 10;

  const winningPositions = new Set();

  // Find all positions that match the score digits
  for (let row = 0; row < GRID_CONFIG.ROWS; row++) {
    const rowDigits = GRID_CONFIG.ROW_DIGITS[row];

    // Check if home score matches this row
    if (rowDigits.includes(homeLastDigit)) {
      // This row with away column wins
      const position = row * GRID_CONFIG.COLS + awayLastDigit;
      if (position < GRID_CONFIG.TOTAL_SQUARES) {
        winningPositions.add(position);
      }
    }

    // Check if away score matches this row (for reverse)
    if (rowDigits.includes(awayLastDigit) && homeLastDigit !== awayLastDigit) {
      // This row with home column wins
      const position = row * GRID_CONFIG.COLS + homeLastDigit;
      if (position < GRID_CONFIG.TOTAL_SQUARES) {
        winningPositions.add(position);
      }
    }
  }

  return Array.from(winningPositions);
}

/**
 * Get display information for a position
 */
function getPositionDisplay(position) {
  if (position < 0 || position >= GRID_CONFIG.TOTAL_SQUARES) {
    return null;
  }

  const row = Math.floor(position / GRID_CONFIG.COLS);
  const col = position % GRID_CONFIG.COLS;
  const rowDigits = GRID_CONFIG.ROW_DIGITS[row];
  const colDigit = GRID_CONFIG.COL_DIGITS[col];

  return {
    position,
    row,
    col,
    rowDigits,
    colDigit,
    label: `[${rowDigits.join("/")}][${colDigit}]`,
  };
}

/**
 * Get all positions that could win with specific digits
 */
function getPositionsForDigits(homeDigit, awayDigit) {
  const positions = [];

  // Find positions where home digit determines row
  for (let row = 0; row < GRID_CONFIG.ROWS; row++) {
    if (GRID_CONFIG.ROW_DIGITS[row].includes(homeDigit)) {
      const position = row * GRID_CONFIG.COLS + awayDigit;
      if (position < GRID_CONFIG.TOTAL_SQUARES) {
        positions.push({
          position,
          type: "home-row",
          description: `Home ${homeDigit} (row), Away ${awayDigit} (col)`,
        });
      }
    }
  }

  // Find positions where away digit determines row (if different)
  if (homeDigit !== awayDigit) {
    for (let row = 0; row < GRID_CONFIG.ROWS; row++) {
      if (GRID_CONFIG.ROW_DIGITS[row].includes(awayDigit)) {
        const position = row * GRID_CONFIG.COLS + homeDigit;
        if (position < GRID_CONFIG.TOTAL_SQUARES) {
          positions.push({
            position,
            type: "away-row",
            description: `Away ${awayDigit} (row), Home ${homeDigit} (col)`,
          });
        }
      }
    }
  }

  return positions;
}

// =====================================
// SQUARE ASSIGNMENT LOGIC
// =====================================

/**
 * Get available positions on a board (skill-based: positions with < 2 players)
 */
function getAvailablePositions(board, userId = null) {
  const available = [];

  for (let i = 0; i < GRID_CONFIG.TOTAL_SQUARES; i++) {
    const squareData = board.squares?.[i] || { claims: [], isFull: false };

    // Check if square has room (less than 2 claims)
    if (squareData.claims.length < 2) {
      // If userId provided, check if user already has this square
      if (userId) {
        const userAlreadyOnSquare = squareData.claims.some(
          (claim) => claim.userId === userId
        );
        if (!userAlreadyOnSquare) {
          available.push(i);
        }
      } else {
        available.push(i);
      }
    }
  }

  return available;
}

/**
 * Randomly assign a square to a user (skill-based version)
 */
async function assignRandomSquare(
  db,
  userId,
  boardId,
  accessTokenId,
  tokenData = {}
) {
  return await safeTransaction(db, async (transaction) => {
    // Get board within transaction
    const boardRef = db.collection("boards").doc(boardId);
    const boardDoc = await transaction.get(boardRef);

    if (!boardDoc.exists) {
      throw createError("not-found", "Board not found");
    }

    const board = boardDoc.data();

    // Check if board is active
    if (!board.isActive) {
      throw createError("validation", "Board is no longer active");
    }

    // Get available positions (positions with < 2 players where user doesn't already have a claim)
    const available = getAvailablePositions(board, userId);

    if (available.length === 0) {
      throw createError("validation", "No available squares on this board");
    }

    // Check user's total squares on this board
    let userSquareCount = 0;
    Object.values(board.squares || {}).forEach((squareData) => {
      if (squareData.claims) {
        userSquareCount += squareData.claims.filter(
          (claim) => claim.userId === userId
        ).length;
      }
    });

    if (userSquareCount >= GAME_CONFIG.MAX_SQUARES_PER_USER_PER_BOARD) {
      throw createError("validation", ERROR_MESSAGES.MAX_SQUARES_REACHED);
    }

    // Select random position (unbiased)
    const selectedPosition = available[secureRandomInt(0, available.length)];

    // Create claim record
    const claimRef = db.collection("squareClaims").doc();
    const claimData = {
      id: claimRef.id,
      userId,
      boardId,
      position: selectedPosition,

      // Timing from token
      triviaAnswerTimeMs: tokenData.answerTimeMs || 0,
      triviaAnswerTimeSeconds: tokenData.answerTimeSeconds || 0,

      // Consolation tracking
      isConsolationSquare: tokenData.isConsolationToken || false,
      sourceWinnerId: tokenData.sourceWinnerId || null,
      canEarnConsolation: tokenData.canEarnConsolation !== false,

      earnedVia: tokenData.isConsolationToken ? "consolation" : "trivia",
      accessTokenId,
      placedAt: getTimestamp(),
      isWinner: false,
      winningQuarter: null,
      prizeAmount: null,
      metadata: {
        availableCount: available.length,
        userSquareCount: userSquareCount + 1,
      },
    };

    transaction.set(claimRef, claimData);

    // Update board squares structure
    const currentSquareData = board.squares?.[selectedPosition] || {
      claims: [],
      isFull: false,
    };
    const updatedClaims = [
      ...currentSquareData.claims,
      {
        userId,
        claimId: claimRef.id,
        answerTimeSeconds: tokenData.answerTimeSeconds || 0,
      },
    ];

    transaction.update(boardRef, {
      [`squares.${selectedPosition}`]: {
        claims: updatedClaims,
        isFull: updatedClaims.length >= 2,
      },
      lastUpdated: getTimestamp(),
    });

    // Mark access token as used (corrected collection name)
    if (accessTokenId) {
      const tokenRef = db.collection("accessTokens").doc(accessTokenId);
      transaction.update(tokenRef, {
        usedForSquare: true,
        usedAt: getTimestamp(),
        usedOnBoardId: boardId,
        assignedPosition: selectedPosition,
        claimId: claimRef.id,
      });
    }

    return {
      success: true,
      position: selectedPosition,
      claimId: claimRef.id,
      remainingSquares: available.length - 1,
      squareOccupancy: `${updatedClaims.length}/2`,
    };
  });
}

/**
 * Allow user to select their own square (skill-based version)
 */
async function selectSquare(
  db,
  userId,
  boardId,
  position,
  accessTokenId,
  tokenData = {}
) {
  // Validate position
  const positionValidation = validateSquarePosition(position);
  if (!positionValidation.valid) {
    throw createError("validation", positionValidation.error);
  }

  return await safeTransaction(db, async (transaction) => {
    const boardRef = db.collection("boards").doc(boardId);
    const boardDoc = await transaction.get(boardRef);

    if (!boardDoc.exists) {
      throw createError("not-found", "Board not found");
    }

    const board = boardDoc.data();

    // Check square occupancy
    const squareData = board.squares?.[position] || {
      claims: [],
      isFull: false,
    };

    if (squareData.claims.length >= 2) {
      throw createError(
        "resource-exhausted",
        "This square is full (2 players maximum)"
      );
    }

    // Check if user already has this square
    const userAlreadyOnSquare = squareData.claims.some(
      (claim) => claim.userId === userId
    );

    if (userAlreadyOnSquare) {
      throw createError("already-exists", "You already have this square");
    }

    // Check user's total squares
    let userSquareCount = 0;
    Object.values(board.squares || {}).forEach((sq) => {
      if (sq.claims) {
        userSquareCount += sq.claims.filter(
          (claim) => claim.userId === userId
        ).length;
      }
    });

    if (userSquareCount >= GAME_CONFIG.MAX_SQUARES_PER_USER_PER_BOARD) {
      throw createError("validation", ERROR_MESSAGES.MAX_SQUARES_REACHED);
    }

    // Create claim record
    const claimRef = db.collection("squareClaims").doc();
    const claimData = {
      id: claimRef.id,
      userId,
      boardId,
      position,

      // Timing from token
      triviaAnswerTimeMs: tokenData.answerTimeMs || 0,
      triviaAnswerTimeSeconds: tokenData.answerTimeSeconds || 0,

      // Consolation tracking
      isConsolationSquare: tokenData.isConsolationToken || false,
      sourceWinnerId: tokenData.sourceWinnerId || null,
      canEarnConsolation: tokenData.canEarnConsolation !== false,

      earnedVia: tokenData.isConsolationToken ? "consolation" : "trivia",
      accessTokenId,
      placedAt: getTimestamp(),
      isWinner: false,
      selectedManually: true,
    };

    transaction.set(claimRef, claimData);

    // Update board squares structure
    const updatedClaims = [
      ...squareData.claims,
      {
        userId,
        claimId: claimRef.id,
        answerTimeSeconds: tokenData.answerTimeSeconds || 0,
      },
    ];

    transaction.update(boardRef, {
      [`squares.${position}`]: {
        claims: updatedClaims,
        isFull: updatedClaims.length >= 2,
      },
      lastUpdated: getTimestamp(),
    });

    // Mark token as used (corrected collection name)
    if (accessTokenId) {
      transaction.update(db.collection("accessTokens").doc(accessTokenId), {
        usedForSquare: true,
        usedAt: getTimestamp(),
        usedOnBoardId: boardId,
        assignedPosition: position,
        claimId: claimRef.id,
      });
    }

    return {
      success: true,
      position,
      claimId: claimRef.id,
      squareOccupancy: `${updatedClaims.length}/2`,
    };
  });
}

// =====================================
// SKILL-BASED WINNER PROCESSING
// =====================================

/**
 * Process winners for a specific quarter - SKILL-BASED VERSION
 */
async function processQuarterWinners(db, gameId, quarter, score, gameData) {
  const winningPositions = calculateWinningPositions(score.home, score.away);

  console.log(`Processing ${quarter} winners for game ${gameId}`);
  console.log(`Score: ${score.home}-${score.away}`);
  console.log(`Winning positions: ${winningPositions.join(", ")}`);

  // Get all boards for this game
  const boardsSnapshot = await db
    .collection("boards")
    .where("gameId", "==", gameId)
    .get();

  const winners = [];
  const consolationGrants = [];
  const batch = db.batch();

  for (const boardDoc of boardsSnapshot.docs) {
  const board = boardDoc.data();
  console.log("🔎 Processing board:", boardDoc.id, "tierId=", board.tierId);

  const tier = getTierById(board.tierId);
  console.log("   → Tier:", tier);

  const quarterPrize = calculatePrizes(tier.amount).quarterPrize;
  console.log("   → Quarter prize:", quarterPrize);

  // Initialize consolation counter if not present
  const currentConsolations = board.consolationSquaresAwarded || 0;
  console.log("   → Current consolations:", currentConsolations);

  // Check each winning position
  for (const position of winningPositions) {
    console.log("⚡ Checking position:", position);

    const squareData = board.squares?.[position];
    if (!squareData) {
      console.log("   → No square data at", position);
      continue;
    }

    if (!squareData.claims || squareData.claims.length === 0) {
      console.log("   → No claims for position", position);
      continue;
    }

    console.log("   → Claims count:", squareData.claims.length);

    // SKILL-BASED: Find fastest answer time
    let winner = null;
    let loser = null;

    if (squareData.claims.length === 1) {
      winner = squareData.claims[0];
      console.log("   ✅ Single claim → winner:", winner);
    } else {
      const sorted = [...squareData.claims].sort(
        (a, b) => a.answerTimeSeconds - b.answerTimeSeconds
      );
      winner = sorted[0];
      loser = sorted[1];
      console.log("   ✅ Multi-claim sorted:", { winner, loser });
    }

    // Get full claim data for winner
    const winnerClaimDoc = await db
      .collection("squareClaims")
      .doc(winner.claimId)
      .get();
    const winnerClaim = winnerClaimDoc.data();
    console.log("   → Winner claim data:", winnerClaim);

    // Get loser claim data if exists
    let loserClaim = null;
    if (loser) {
      try {
        const loserClaimDoc = await db
          .collection("squareClaims")
          .doc(loser.claimId)
          .get();
        loserClaim = loserClaimDoc.exists ? loserClaimDoc.data() : null;
        console.log("   → Loser claim data:", loserClaim);
      } catch (error) {
        console.error("❌ Error fetching loser claim:", {
          message: error.message,
          stack: error.stack,
          loser,
        });
        loserClaim = { triviaAnswerTimeMs: 0 }; // Default fallback
      }
    }

    // Create winner record
    const winnerRef = db.collection("winners").doc();
    const winnerData = {
      userId: winner.userId,
      gameId,
      boardId: boardDoc.id,
      claimId: winner.claimId,
      position,
      quarter,
      score: `${score.home}-${score.away}`,
      tierId: board.tierId,
      prizeAmount: quarterPrize,

      // Skill-based fields
      winnerAnswerTimeMs: winnerClaim?.triviaAnswerTimeMs || null,
      winnerAnswerTimeSeconds: winner.answerTimeSeconds,
      loserUserId: loser?.userId || null,
      loserAnswerTimeMs: loserClaim?.triviaAnswerTimeMs || null,
      loserAnswerTimeSeconds: loser?.answerTimeSeconds || null,
      consolationSquareGranted: false,
      consolationSquareId: null,

      gameInfo: gameData.teams,
      notificationStatus: "pending",
      status: "pending_payout",
      createdAt: getTimestamp(),
    };

    console.log("🏆 Winner data to save:", winnerData);

    batch.set(winnerRef, winnerData);

    // Update winner's claim
    batch.update(db.collection("squareClaims").doc(winner.claimId), {
      isWinner: true,
      winningQuarter: quarter,
      prizeAmount: quarterPrize,
    });
    console.log("   → Winner claim updated:", winner.claimId);

    // Handle consolation prize for loser
    if (
      loser &&
      winnerClaim?.canEarnConsolation &&
      currentConsolations < 4
    ) {
      console.log("🎁 Consolation grant triggered:", {
        winnerId: winnerRef.id,
        loserId: loser.userId,
        winnerTime: winner.answerTimeSeconds,
        loserTime: loser.answerTimeSeconds,
      });

      consolationGrants.push({
        winnerId: winnerRef.id,
        loserUserId: loser.userId,
        boardId: boardDoc.id,
        tierId: board.tierId,
        winnerTime: winner.answerTimeSeconds,
        loserTime: loser.answerTimeSeconds,
      });

      batch.update(winnerRef, { consolationSquareGranted: true });
      batch.update(boardDoc.ref, {
        consolationSquaresAwarded: admin.firestore.FieldValue.increment(1),
      });
    }

    winners.push({ id: winnerRef.id, ...winnerData });
  }
}


  // Commit all updates
  await batch.commit();

  // Process consolation squares separately
  for (const grant of consolationGrants) {
    await grantConsolationSquare(db, grant);
  }

  console.log(`Created ${winners.length} winner records for ${quarter}`);
  console.log(`Granted ${consolationGrants.length} consolation squares`);

  return winners;
}

/**
 * Grant consolation square to loser
 */
async function grantConsolationSquare(db, grant) {
  const { winnerId, loserUserId, boardId, tierId, winnerTime, loserTime } =
    grant;

  try {
    // Find next available board for same tier
    const currentBoardDoc = await db.collection("boards").doc(boardId).get();
    const currentBoard = currentBoardDoc.data();

    const nextBoardQuery = await db
      .collection("boards")
      .where("tierId", "==", tierId)
      .where("gameId", "!=", currentBoard.gameId)
      .where("isActive", "==", true)
      .orderBy("gameId")
      .orderBy("createdAt")
      .limit(1)
      .get();

    if (nextBoardQuery.empty) {
      console.log("No future boards available for consolation square");
      return null;
    }

    const nextBoard = nextBoardQuery.docs[0];
    const nextBoardData = nextBoard.data();

    // Create consolation token (corrected collection name)
    const tokenRef = await db.collection("accessTokens").add({
      userId: loserUserId,
      boardId: nextBoard.id,
      tier: tierId,

      // Mark as consolation
      isConsolationToken: true,
      sourceWinnerId: winnerId,
      canEarnConsolation: false, // Cannot earn another consolation

      // No timing data - will use random placement
      answerTimeMs: 0,
      answerTimeSeconds: 0,

      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      used: false,

      metadata: {
        sourceBoardId: boardId,
        nextGameInfo: nextBoardData.gameInfo,
      },
    });

    // Update winner record with consolation info
    try {
      if (!winnerId || !tokenRef?.id) {
        throw new Error(
          `Invalid winnerId (${winnerId}) or tokenRef.id (${tokenRef?.id})`
        );
      }

      await db.collection("winners").doc(winnerId).update({
        consolationSquareId: tokenRef.id,
        consolationGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("Error updating winner with consolation info:", {
        message: error.message,
        stack: error.stack,
        winnerId,
        tokenId: tokenRef?.id,
      });
    }

    // Queue consolation notification instead of direct call
    await db.collection("notificationQueue").add({
      type: "consolation",
      userId: loserUserId,
      data: {
        nextBoardId: nextBoard.id,
        winnerTime: winnerTime,
        loserTime: loserTime,
        game: nextBoardData.gameInfo,
      },
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `Granted consolation square to user ${loserUserId} for board ${nextBoard.id}`
    );

    return {
      tokenId: tokenRef.id,
      boardId: nextBoard.id,
      userId: loserUserId,
    };
  } catch (error) {
    console.error("Error granting consolation square:", error);
    return null;
  }
}

// =====================================
// REACT COMPONENTS
// =====================================

// Note: React components require a separate build process
// These are included for reference but need to be compiled separately

const React = require("react");
const { useState, useEffect } = React;

/**
 * Visual grid component for users (skill-based version)
 */
function UserSquareGrid({
  board,
  currentUserId,
  onSquareClick,
  allowSelection = false,
}) {
  const [hoveredSquare, setHoveredSquare] = useState(null);

  const getSquareStatus = (position) => {
    const squareData = board.squares?.[position];
    if (!squareData || !squareData.claims || squareData.claims.length === 0) {
      return "available";
    }

    // Check if current user has this square
    const userClaim = squareData.claims.find(
      (claim) => claim.userId === currentUserId
    );
    if (userClaim) {
      return "mine";
    }

    // Check occupancy
    if (squareData.claims.length === 1) {
      return "partial"; // 1/2 occupied
    } else {
      return "full"; // 2/2 occupied
    }
  };

  const getSquareColor = (status) => {
    switch (status) {
      case "available":
        return "bg-white hover:bg-blue-50 border-gray-300";
      case "mine":
        return "bg-blue-500 text-white border-blue-600";
      case "partial":
        return "bg-yellow-200 text-gray-700 border-yellow-400";
      case "full":
        return "bg-red-400 text-white border-red-500";
      default:
        return "bg-gray-100";
    }
  };

  const getSquareText = (position) => {
    const squareData = board.squares?.[position];
    const status = getSquareStatus(position);

    if (status === "mine") return "YOU";
    if (status === "partial") return "1/2";
    if (status === "full") return "FULL";
    if (hoveredSquare === position) return position.toString();
    return "";
  };

  return React.createElement(
    "div",
    { className: "bg-white p-4 rounded-lg shadow" },
    // Header
    React.createElement(
      "div",
      { className: "mb-4" },
      React.createElement(
        "h3",
        { className: "text-lg font-bold" },
        `${board.gameInfo?.teams?.away} @ ${board.gameInfo?.teams?.home}`
      ),
      React.createElement(
        "div",
        {
          className:
            "flex items-center justify-between text-sm text-gray-600 mt-1",
        },
        React.createElement(
          "span",
          null,
          `Tier: $${board.tierId?.replace("tier_", "")}`
        ),
        React.createElement(
          "span",
          null,
          `${Object.values(board.squares || {}).filter((s) => s.claims?.length > 0).length} squares claimed`
        )
      )
    ),

    // Column headers
    React.createElement(
      "div",
      { className: "grid grid-cols-11 gap-1 mb-1" },
      React.createElement("div"), // Empty corner
      ...GRID_CONFIG.COL_DIGITS.map((digit) =>
        React.createElement(
          "div",
          {
            key: digit,
            className: "text-center text-xs font-bold text-gray-700",
          },
          digit
        )
      )
    ),

    // Grid with row headers
    ...GRID_CONFIG.ROW_DIGITS.map((rowDigits, row) =>
      React.createElement(
        "div",
        { key: row, className: "grid grid-cols-11 gap-1 mb-1" },
        // Row header
        React.createElement(
          "div",
          {
            className:
              "flex items-center justify-center text-xs font-bold text-gray-700 pr-1",
          },
          rowDigits.join("/")
        ),

        // Squares
        ...GRID_CONFIG.COL_DIGITS.map((col) => {
          const position = row * GRID_CONFIG.COLS + col;
          const status = getSquareStatus(position);
          const isClickable =
            allowSelection && (status === "available" || status === "partial");

          return React.createElement(
            "div",
            {
              key: position,
              onClick: () => isClickable && onSquareClick?.(position),
              onMouseEnter: () => setHoveredSquare(position),
              onMouseLeave: () => setHoveredSquare(null),
              className: `
              aspect-square border-2 rounded flex items-center justify-center
              text-xs font-medium transition-all
              ${getSquareColor(status)}
              ${isClickable ? "cursor-pointer transform hover:scale-105" : "cursor-default"}
              ${hoveredSquare === position ? "z-10 shadow-lg" : ""}
            `,
            },
            getSquareText(position)
          );
        })
      )
    ),

    // Legend
    React.createElement(
      "div",
      { className: "mt-4 flex flex-wrap gap-4 text-xs" },
      React.createElement(
        "div",
        { className: "flex items-center gap-1" },
        React.createElement("div", {
          className: "w-4 h-4 bg-white border-2 border-gray-300 rounded",
        }),
        React.createElement("span", null, "Open (0/2)")
      ),
      React.createElement(
        "div",
        { className: "flex items-center gap-1" },
        React.createElement("div", {
          className: "w-4 h-4 bg-yellow-200 border-2 border-yellow-400 rounded",
        }),
        React.createElement("span", null, "Partial (1/2)")
      ),
      React.createElement(
        "div",
        { className: "flex items-center gap-1" },
        React.createElement("div", {
          className: "w-4 h-4 bg-red-400 border-2 border-red-500 rounded",
        }),
        React.createElement("span", null, "Full (2/2)")
      ),
      React.createElement(
        "div",
        { className: "flex items-center gap-1" },
        React.createElement("div", {
          className: "w-4 h-4 bg-blue-500 border-2 border-blue-600 rounded",
        }),
        React.createElement("span", null, "Your squares")
      )
    ),

    // Skill-based explanation
    React.createElement(
      "div",
      { className: "mt-4 p-3 bg-blue-50 rounded text-sm" },
      React.createElement(
        "p",
        { className: "font-semibold mb-1" },
        "🏃 Skill-Based Competition:"
      ),
      React.createElement(
        "p",
        null,
        "Up to 2 players can claim each square. When a square's numbers match the game score, the player with the ",
        React.createElement("strong", null, "fastest trivia answer time"),
        " wins!"
      ),
      React.createElement(
        "p",
        { className: "mt-1 text-xs text-gray-600" },
        "Didn't win? You'll get a free square for the next game as consolation."
      )
    )
  );
}

/**
 * Admin grid component with extra features (skill-based version)
 */
function AdminSquareGrid({ board, onSquareClick }) {
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [testScore, setTestScore] = useState({ home: "", away: "" });
  const [winningPositions, setWinningPositions] = useState([]);

  // Calculate winners when test score changes
  useEffect(() => {
    if (testScore.home && testScore.away) {
      const positions = calculateWinningPositions(
        parseInt(testScore.home),
        parseInt(testScore.away)
      );
      setWinningPositions(positions);
    } else {
      setWinningPositions([]);
    }
  }, [testScore]);

  const getSquareColor = (position) => {
    if (winningPositions.includes(position))
      return "bg-yellow-400 border-yellow-600";
    if (selectedSquare === position) return "bg-purple-400 border-purple-600";

    const squareData = board.squares?.[position];
    if (!squareData) return "bg-white border-gray-300";

    const occupancy = squareData.claims?.length || 0;
    if (occupancy === 0) return "bg-white border-gray-300";
    if (occupancy === 1) return "bg-yellow-200 border-yellow-400";
    return "bg-red-400 border-red-500";
  };

  const getSquareInfo = (position) => {
    const squareData = board.squares?.[position];
    if (!squareData || !squareData.claims) return { text: "", subtext: "" };

    const claims = squareData.claims;
    if (claims.length === 0) return { text: "OPEN", subtext: "" };
    if (claims.length === 1) {
      return {
        text: "1/2",
        subtext: `${claims[0].answerTimeSeconds}s`,
      };
    }
    return {
      text: "FULL",
      subtext: `${claims[0].answerTimeSeconds}s/${claims[1].answerTimeSeconds}s`,
    };
  };

  return React.createElement(
    "div",
    { className: "bg-white p-6 rounded-lg shadow-lg" },
    // Test score input
    React.createElement(
      "div",
      { className: "mb-4 bg-gray-50 p-3 rounded" },
      React.createElement(
        "h4",
        { className: "font-semibold mb-2" },
        "Test Winner Calculation"
      ),
      React.createElement(
        "div",
        { className: "flex gap-4 items-center" },
        React.createElement("input", {
          type: "number",
          placeholder: "Home",
          value: testScore.home,
          onChange: (e) => setTestScore({ ...testScore, home: e.target.value }),
          className: "w-20 px-2 py-1 border rounded",
        }),
        React.createElement("span", null, "-"),
        React.createElement("input", {
          type: "number",
          placeholder: "Away",
          value: testScore.away,
          onChange: (e) => setTestScore({ ...testScore, away: e.target.value }),
          className: "w-20 px-2 py-1 border rounded",
        }),
        winningPositions.length > 0 &&
          React.createElement(
            "span",
            { className: "text-yellow-600 font-semibold" },
            `Winners: ${winningPositions.join(", ")}`
          )
      )
    ),

    // Grid
    React.createElement(
      "div",
      { className: "mb-4" },
      // Column headers
      React.createElement(
        "div",
        { className: "grid grid-cols-11 gap-1 mb-1" },
        React.createElement("div"), // Empty corner
        ...GRID_CONFIG.COL_DIGITS.map((digit) =>
          React.createElement(
            "div",
            { key: digit, className: "text-center text-xs font-bold" },
            digit
          )
        )
      ),

      // Grid with row headers
      ...GRID_CONFIG.ROW_DIGITS.map((rowDigits, row) =>
        React.createElement(
          "div",
          { key: row, className: "grid grid-cols-11 gap-1 mb-1" },
          // Row header
          React.createElement(
            "div",
            {
              className:
                "flex items-center justify-center text-xs font-bold pr-1",
            },
            rowDigits.join("/")
          ),

          // Squares
          ...GRID_CONFIG.COL_DIGITS.map((col) => {
            const position = row * GRID_CONFIG.COLS + col;
            const info = getSquareInfo(position);

            return React.createElement(
              "div",
              {
                key: position,
                onClick: () => {
                  setSelectedSquare(position);
                  onSquareClick?.(position);
                },
                className: `
                aspect-square border-2 rounded flex flex-col items-center justify-center
                text-xs font-medium transition-all cursor-pointer hover:scale-105
                ${getSquareColor(position)}
              `,
              },
              React.createElement("div", null, info.text),
              info.subtext &&
                React.createElement(
                  "div",
                  { className: "text-[10px] opacity-75" },
                  info.subtext
                )
            );
          })
        )
      )
    ),

    // Selected square info
    selectedSquare !== null &&
      React.createElement(
        "div",
        { className: "mt-4 p-3 bg-purple-50 rounded" },
        React.createElement(
          "h4",
          { className: "font-semibold" },
          `Square ${selectedSquare} Details`
        ),
        React.createElement(
          "pre",
          { className: "mt-2 text-xs bg-white p-2 rounded overflow-auto" },
          JSON.stringify(board.squares?.[selectedSquare] || {}, null, 2)
        )
      )
  );
}

// =====================================
// TESTING UTILITIES
// =====================================

/**
 * Generate test board with skill-based squares
 */
function generateTestBoard(fillPercentage = 0.5) {
  const squares = {};
  const numSquares = Math.floor(GRID_CONFIG.TOTAL_SQUARES * fillPercentage);
  const positions = Array.from(
    { length: GRID_CONFIG.TOTAL_SQUARES },
    (_, i) => i
  );

  // Shuffle and take first N positions
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  positions.slice(0, numSquares).forEach((pos, index) => {
    // Randomly assign 1 or 2 players per square
    const numPlayers = Math.random() > 0.5 ? 2 : 1;
    const claims = [];

    for (let i = 0; i < numPlayers; i++) {
      claims.push({
        userId: `testuser${index * 2 + i}`,
        claimId: `claim${pos}_${i}`,
        answerTimeSeconds: Math.round((Math.random() * 5 + 2) * 10) / 10, // 2.0 - 7.0s
      });
    }

    squares[pos] = {
      claims,
      isFull: claims.length === 2,
    };
  });

  return {
    gameId: "test-game",
    tierId: "tier_100",
    squares,
    consolationSquaresAwarded: 0,
    maxPlayersPerSquare: 2,
    gameInfo: {
      teams: { home: "Test Home", away: "Test Away" },
      sport: "NFL",
    },
    isActive: true,
  };
}

/**
 * Test winner calculation with skill-based system
 */
function testSkillBasedWinners() {
  const testCases = [
    {
      home: 21,
      away: 17,
      players: [
        { userId: "player1", time: 3.2 },
        { userId: "player2", time: 4.1 },
      ],
      expected: "player1 wins (faster time)",
    },
    {
      home: 0,
      away: 0,
      players: [{ userId: "player1", time: 5.5 }],
      expected: "player1 wins (only player)",
    },
    {
      home: 35,
      away: 28,
      players: [
        { userId: "player1", time: 2.8 },
        { userId: "player2", time: 2.8 },
      ],
      expected: "Tie scenario - first registered wins",
    },
  ];

  console.log("Testing skill-based winner determination:\n");

  testCases.forEach(({ home, away, players, expected }) => {
    const positions = calculateWinningPositions(home, away);
    console.log(`Score ${home}-${away}:`);
    console.log(`  Winning positions: ${positions.join(", ")}`);
    console.log(
      `  Players: ${players.map((p) => `${p.userId} (${p.time}s)`).join(", ")}`
    );
    console.log(`  Expected: ${expected}\n`);
  });
}

// =====================================
// COMMONJS EXPORTS
// =====================================

module.exports = {
  // Configuration
  GRID_CONFIG,

  // Core functions
  calculateWinningPositions,
  getPositionDisplay,
  getPositionsForDigits,
  getAvailablePositions,

  // Square assignment
  assignRandomSquare,
  selectSquare,

  // Components
  UserSquareGrid,
  AdminSquareGrid,

  // Winner processing
  processQuarterWinners,
  grantConsolationSquare,

  // Testing
  generateTestBoard,
  testSkillBasedWinners,
};
