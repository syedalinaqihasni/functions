// legal-components-skill-based.js
// Legal documentation for Square Trivia skill-based system with timing privacy

const TermsOfService = {
  title: "Terms of Service",
  lastUpdated: new Date().toISOString(),
  sections: [
    {
      id: "skill-based-competition",
      title: "1. Skill-Based Competition",
      content: `Square Trivia is a skill-based trivia competition platform. Participation and success depend entirely on participants' knowledge and skill in answering trivia questions correctly and quickly. Winners are determined by the speed of their correct trivia answers. This is not a game of chance, lottery, or gambling service.`
    },
    {
      id: "donations-access",
      title: "2. Donations and Access",
      content: `Donations made through our platform grant access to exclusive Telegram groups where participants can engage with our community and attempt trivia challenges. Donations are voluntary contributions that support our platform's operations and are not payments for squares or guaranteed prizes.`
    },
    {
      id: "free-entry",
      title: "3. Free Alternative Method of Entry (AMOE)",
      content: `NO PURCHASE NECESSARY. A free alternative method of entry is available. Participants may submit a handwritten entry by mail including their name, email address, phone number, and desired tier. Mail entries to:

Square Trivia AMOE
[Your Address Line 1]
[Your Address Line 2]
[City, State ZIP]

Free entries will be processed within 5-7 business days and participants will receive the same access and opportunities as those who donate.

Note: Free entry participants compete under the same rules as all players, including the privacy of answer times until squares win. Your skill in answering trivia questions quickly determines your success.`
    },
    {
      id: "trivia-square-allocation",
      title: "4. Trivia and Square Allocation",
      content: `Squares are earned exclusively through correct answers to trivia questions. Each square position may accommodate up to two (2) players on a first-come, first-served basis. When you answer a trivia question correctly, you may select any available square position that has fewer than 2 players.

Skill-Based Winner Determination: When a square's numbers match the game score at the end of any quarter, the player on that square who answered their trivia question in the shortest time wins the prize. This is determined purely by skill - the faster player always wins.

Answer Time Privacy: To maintain competitive integrity and suspense, trivia answer times are not visible to other players until a square wins. You can see your own answer times on squares you've claimed, but other players' times remain hidden until the square's numbers match the game score. This ensures fair competition where players cannot strategically avoid squares with fast answer times.

Consolation Prizes: If two players occupy a winning square position, the player with the slower trivia answer time receives one (1) free square for a future game board as a consolation prize. A maximum of four (4) consolation squares are awarded per board. Squares earned through consolation prizes cannot earn additional consolation prizes if they lose a future skill competition.`
    },
    {
      id: "winner-determination",
      title: "5. Skill-Based Winner Determination",
      content: `Winners are determined solely by the speed of correct trivia answers, measured from the moment a question is displayed until the answer is submitted. Answer times are recorded to the nearest tenth of a second (0.1s).

The Process:
- When you start a trivia question, our system records the exact start time
- When you submit your answer, the system calculates your answer time
- This time is permanently associated with your square
- Your time remains private and is not shown to other players
- If your square's numbers match the game score, your answer time is compared with any other player on the same square
- Both times are revealed simultaneously when the square wins
- The player with the faster answer time wins the prize

Privacy Until Victory: The skill-based competition includes a privacy feature where answer times are concealed from competitors until the moment of determination. When a square's numbers match the game score, both players' answer times are revealed simultaneously, and the faster time wins. This "blind competition" format ensures that all players compete on equal footing without advance knowledge of their competition's performance.

Important: Game scores merely determine which squares are activated for skill-based competition. The winner is always determined by skill (answer speed), never by chance.`
    },
    {
      id: "prizes-payouts",
      title: "6. Prizes and Payouts",
      content: `Prize amounts vary by tier and are distributed after game completion to the player with the fastest trivia answer time on each winning square. All prizes are subject to applicable taxes, which are the sole responsibility of the winner. Answer times are revealed only when squares win, creating exciting moments of discovery.`
    },
    {
      id: "eligibility",
      title: "7. Eligibility",
      content: `Participation is open to legal residents of the United States who are 18 years of age or older. Void where prohibited by law. Employees, officers, and directors of Square Trivia and their immediate family members are not eligible to participate.`
    },
    {
      id: "disclaimer",
      title: "8. Disclaimer of Warranties",
      content: `THE PLATFORM IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE MAKE NO GUARANTEES ABOUT UPTIME, AVAILABILITY, OR FUNCTIONALITY. PARTICIPATION IS AT YOUR OWN RISK.`
    },
    {
      id: "limitation-liability",
      title: "9. Limitation of Liability",
      content: `TO THE MAXIMUM EXTENT PERMITTED BY LAW, SQUARE TRIVIA SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO YOUR USE OF THE PLATFORM.`
    }
  ]
};

const PrivacyPolicy = {
  title: "Privacy Policy",
  lastUpdated: new Date().toISOString(),
  sections: [
    {
      id: "information-collected",
      title: "Information We Collect",
      content: `We collect the following information:
- Account information (email, username, password)
- Profile information (Telegram username)
- Transaction data (donation history)
- Game participation data (trivia answers, answer times, square selections)
- Performance data (trivia answer speeds, skill metrics)
- Communication data (support tickets, emails)

Note: Trivia answer times are collected for skill-based winner determination but are kept private from other players until a square wins.`
    },
    {
      id: "information-use",
      title: "How We Use Your Information",
      content: `We use your information to:
- Provide and maintain our services
- Process donations and grant access
- Conduct trivia competitions and measure performance
- Determine winners based on skill performance
- Maintain privacy of answer times until squares win
- Distribute prizes to winners
- Award consolation prizes
- Communicate important updates
- Comply with legal obligations`
    },
    {
      id: "data-security",
      title: "Data Security",
      content: `We implement industry-standard security measures to protect your personal information, including encryption, secure servers, and regular security audits. Trivia answer timing data is securely stored and protected against tampering to ensure fair competition. Answer times are encrypted and access-controlled to maintain competitive privacy until squares win.`
    },
    {
      id: "third-party",
      title: "Third-Party Services",
      content: `We use the following third-party services:
- Stripe for payment processing
- Firebase for data storage and authentication
- Telegram for group communications

These services do not have access to hidden answer time data.`
    },
    {
      id: "your-rights",
      title: "Your Rights",
      content: `You have the right to:
- Access your personal data
- Correct inaccurate data
- Request deletion of your data
- Opt-out of marketing communications
- Export your data
- View your performance history and statistics
- See your own answer times on all your squares`
    }
  ],
  contactEmail: "privacy@squaretrivia.com"
};

const FreeEntryInstructions = {
  title: "Free Alternative Method of Entry",
  instructions: {
    overview: "NO PURCHASE NECESSARY. You may enter Square Trivia competitions without making a donation by following the instructions below.",
    
    mailInSteps: [
      {
        step: 1,
        description: "On a 3\" x 5\" card or piece of paper, hand print your:",
        details: [
          "Full legal name",
          "Complete mailing address",
          "Email address",
          "Phone number",
          "Telegram username (if you have one)",
          "Desired tier ($25, $50, $100, $250, $500, or $1000)"
        ]
      },
      {
        step: 2,
        description: "Place the card in a standard #10 envelope"
      },
      {
        step: 3,
        description: "Affix proper postage"
      },
      {
        step: 4,
        description: "Mail to:",
        address: {
          line1: "Square Trivia AMOE",
          line2: "[Your Address Line 1]",
          line3: "[Your Address Line 2]",
          line4: "[City, State ZIP]"
        }
      }
    ],
    
    importantInfo: [
      "Limit one free entry per person per week",
      "Entries must be handwritten - no photocopies or mechanical reproductions",
      "Incomplete or illegible entries will be disqualified",
      "Entries must be received by Friday to be eligible for the following week's games",
      "Free entries receive the same access and opportunities as donated entries",
      "Processing time: 5-7 business days from receipt",
      "You will receive an email confirmation once your entry is processed"
    ],
    
    equalTreatment: {
      description: "All participants, whether entering through donation or free entry, receive:",
      benefits: [
        "Access to the same Telegram groups for their tier",
        "Equal opportunity to answer trivia questions",
        "Same number of square placement opportunities",
        "Identical prize eligibility based on trivia answer speed",
        "Same answer time privacy protection",
        "Same terms and conditions"
      ],
      note: "Free entry participants compete under the same rules as all players, including the privacy of answer times until squares win. Your skill in answering trivia questions quickly determines your success."
    }
  },
  supportEmail: "support@squaretrivia.com"
};

const SkillCertification = {
  title: "Skill-Based Competition Certification",
  lastUpdated: new Date().toISOString(),
  
  legalClassification: {
    title: "Legal Classification",
    content: `Square Trivia operates as a skill-based competition platform, not a gambling or lottery service. Our competitions are carefully designed to ensure that success depends entirely on participants' knowledge and skill in answering trivia questions quickly and correctly. Winners are determined by measurable skill performance, not chance.`
  },
  
  winnerDetermination: {
    title: "Winner Determination Methodology",
    methodology: [
      {
        point: "Pure Skill-Based System",
        description: "Each player's trivia answer speed is recorded in milliseconds from question display to answer submission, then displayed in seconds to the nearest tenth (0.1s)."
      },
      {
        point: "Head-to-Head Competition",
        description: "When two players occupy the same square and it becomes a winning position (matching game score), the player with the faster trivia answer time wins the prize."
      },
      {
        point: "No Element of Chance",
        description: "Given the same answer speeds, the same player would win every time. There are no random elements in determining winners."
      },
      {
        point: "Game Scores as Triggers Only",
        description: "The actual game scores (e.g., 7-3) merely determine which squares are activated for skill-based competition. The scores themselves do not determine winners."
      },
      {
        point: "Blind Competition Format",
        description: "Answer times are kept private until they matter. This prevents any form of strategic manipulation based on visible times and ensures that every square has equal appeal to players regardless of who else has claimed it."
      },
      {
        point: "Consolation Skill Rewards",
        description: "Even losing players in skill contests receive rewards (free squares) based on their demonstrated skill in earning a position on a winning square."
      }
    ],
    example: "If Square 7-3 has Player A (3.2 second answer time) and Player B (2.8 second answer time), and the game ends with a 7-3 score, Player B wins because they demonstrated superior skill with a faster answer time. Neither player knew the other's time until the winning moment, ensuring fair competition."
  },
  
  keyDistinctions: [
    {
      title: "1. Skill Requirement",
      content: "Squares are earned exclusively through correct answers to trivia questions. No squares are awarded randomly or through chance."
    },
    {
      title: "2. Performance-Based Winners",
      content: "Winners are determined by objective, measurable skill performance (answer speed). The faster player always wins, making outcomes predictable based on skill."
    },
    {
      title: "3. No Direct Purchase",
      content: "Donations provide access to Telegram groups and the opportunity to participate. Squares cannot be purchased directly."
    },
    {
      title: "4. Free Entry Available",
      content: "A completely free alternative method of entry ensures no purchase is necessary to participate."
    },
    {
      title: "5. Participant Control",
      content: "Participants choose their own square positions after earning them through correct trivia answers, adding strategic skill elements."
    },
    {
      title: "6. Blind Competition Format",
      content: "Answer times are kept private until they matter. This prevents any form of strategic manipulation based on visible times and ensures that every square has equal appeal to players regardless of who else has claimed it. The revelation of times only upon winning adds an element of suspense while maintaining the purely skill-based nature of the competition."
    }
  ],
  
  complianceMeasures: [
    "Regular legal review of all game mechanics and rules",
    "Transparent disclosure of all terms and conditions",
    "Equal treatment of free and paid participants",
    "Clear skill-based progression system with measurable outcomes",
    "Audit trail for all square allocations and timing data",
    "Server-side timing validation to ensure accuracy and fairness",
    "Privacy protection for answer times until squares win",
    "Compliance with state and federal regulations"
  ],
  
  regulatoryCompliance: {
    description: "Square Trivia maintains compliance with all applicable laws and regulations regarding skill-based competitions, including:",
    items: [
      "Federal Trade Commission guidelines",
      "State-specific skill game regulations",
      "Consumer protection laws",
      "Tax reporting requirements",
      "Privacy and data protection regulations"
    ]
  },
  
  skillVsChanceAnalysis: {
    materialElement: "The material element determining winners is trivia answer speed, which is 100% within player control and based on knowledge and quick thinking.",
    predominance: "Skill predominates over any chance elements. While game scores involve chance, they merely activate competitions - they do not determine winners.",
    anyChance: "Even under the strictest test, the winner determination process itself contains no chance elements - faster answer time always wins.",
    privacy: "The privacy of answer times until squares win does not introduce chance - it simply maintains competitive fairness by preventing strategic manipulation."
  },
  
  contactEmail: "legal@squaretrivia.com"
};

// CommonJS exports
module.exports = {
  TermsOfService,
  PrivacyPolicy,
  FreeEntryInstructions,
  SkillCertification
};