// Function to get short code without dots (KK)
function getShortCode(teamName) {
  return teamName
    .split(" ") // Split into words
    .map((word) => word[0]) // Take first letter of each word
    .join("") // Join without dots
    .toUpperCase(); // Uppercase
}

// Function to get short code with dots (K.K)
function getShortCodeWithDots(teamName) {
  return teamName
    .split(" ")
    .map((word) => word[0])
    .join(".")
    .toUpperCase();
}

// Function to get the first word of the team name
function getFirstWord(teamName) {
  return teamName.split(" ")[0];
}

//examples
// getShortCode("Kolkata Knight Riders"); // "KK"
// getShortCodeWithDots("Kolkata Knight Riders"); // "K.K.R"
// getFIrstWord("Kolkata Knight Riders"); // "Kolkata"

module.exports = {
  getFirstWord,
  getShortCode,
  getShortCodeWithDots,
};
