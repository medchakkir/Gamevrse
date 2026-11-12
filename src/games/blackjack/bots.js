Object.assign(module.exports, { createBot, removeBot, getBotDecision, getBotDecisionStandardMode, getBotDecisionLowestHandMode, calculateRiskOfBeingLowest, getBotRouletteChoice }); // function declarations are hoisted, so cyclic requires resolve
const { handValue } = require('./cards');
const { bots } = require('./state');

let botIdCounter = 0;


function createBot(name, difficulty, roomCode) {
  const botId = `bot_${++botIdCounter}`;
  const bot = {
    id: botId,
    name: name,
    difficulty: difficulty,
    roomCode: roomCode,
    hand: [],
    alive: true,
    busted: false,
    stood: false,
    host: false,
    wins: 0,
    spectator: false,
    ready: false,
    hasSecondChance: true, // Bots also get Second Chance Cards
    secondChanceUsed: false,
    isBot: true,
    // Bot AI state
    riskTolerance: difficulty === 'easy' ? 0.3 : difficulty === 'normal' ? 0.5 : 0.7,
    aggressiveness: difficulty === 'easy' ? 0.2 : difficulty === 'normal' ? 0.5 : 0.8
  };
  
  bots.set(botId, bot);
  return bot;
}


function removeBot(botId) {
  bots.delete(botId);
}


function getBotDecision(bot, gameState) {
  const handVal = handValue(bot.hand);
  const { difficulty, riskTolerance, aggressiveness } = bot;
  const eliminationMode = gameState.rules?.eliminationMode || 'standard';
  
  // 🎯 NEW: Mode-aware bot strategy
  if (eliminationMode === 'lowestHand') {
    // LOWEST-HAND MODE: Bots need to avoid having the lowest hand
    return getBotDecisionLowestHandMode(bot, gameState, handVal, difficulty);
  } else {
    // STANDARD MODE: Original strategy (avoid busting, but busts are prioritized for roulette)
    return getBotDecisionStandardMode(bot, gameState, handVal, difficulty, riskTolerance, aggressiveness);
  }
}


function getBotDecisionStandardMode(bot, gameState, handVal, difficulty, riskTolerance, aggressiveness) {
  // Original logic for Standard Mode
  if (difficulty === 'easy') {
    // Easy bots: Conservative, hit until 17
    return handVal < 17 ? 'hit' : 'stand';
  } else if (difficulty === 'normal') {
    // Normal bots: Balanced strategy
    if (handVal < 12) return 'hit';
    if (handVal >= 17) return 'stand';
    // 12-16: depends on risk tolerance
    return Math.random() < riskTolerance ? 'hit' : 'stand';
  } else { // hard
    // Hard bots: Aggressive, consider game state
    const alivePlayers = Object.values(gameState.players).filter(p => p.alive && !p.spectator);
    const isLateGame = alivePlayers.length <= 3;
    
    if (handVal < 10) return 'hit';
    if (handVal >= 19) return 'stand';
    if (handVal >= 17 && !isLateGame) return 'stand';
    
    // Aggressive play in late game
    const hitChance = isLateGame ? aggressiveness : riskTolerance;
    return Math.random() < hitChance ? 'hit' : 'stand';
  }
}


function getBotDecisionLowestHandMode(bot, gameState, handVal, difficulty) {
  // 🎯 NEW: Lowest-Hand Mode strategy - avoid being the lowest hand
  const alivePlayers = Object.values(gameState.players).filter(p => p.alive && !p.spectator);
  const otherPlayers = alivePlayers.filter(p => p.id !== bot.id);
  
  // Calculate what we know about other players' hands (visible cards)
  const otherHandValues = otherPlayers.map(p => handValue(p.hand)).filter(val => val > 0);
  const lowestOtherHand = otherHandValues.length > 0 ? Math.min(...otherHandValues) : 21;
  const averageOtherHand = otherHandValues.length > 0 ? otherHandValues.reduce((a, b) => a + b, 0) / otherHandValues.length : 18;
  
  console.log(`[BOT AI] ${bot.name} (${handVal}) analyzing Lowest-Hand Mode - Others: [${otherHandValues.join(', ')}], Lowest: ${lowestOtherHand}`);
  
  if (difficulty === 'easy') {
    // Easy bots: Simple strategy - try to beat the lowest visible hand
    if (handVal < lowestOtherHand && handVal < 17) return 'hit';
    if (handVal >= 17) return 'stand';
    return handVal < 15 ? 'hit' : 'stand';
    
  } else if (difficulty === 'normal') {
    // Normal bots: More strategic - consider average and try to stay above lowest
    if (handVal < lowestOtherHand - 1 && handVal < 19) return 'hit'; // Try to beat lowest by margin
    if (handVal >= 19) return 'stand'; // Don't risk busting with good hand
    if (handVal < averageOtherHand - 2 && handVal < 17) return 'hit'; // Stay competitive
    return 'stand';
    
  } else { // hard
    // Hard bots: Advanced strategy - calculate risk vs reward
    const isLateGame = alivePlayers.length <= 3;
    const riskOfBeingLowest = calculateRiskOfBeingLowest(handVal, otherHandValues, isLateGame);
    
    // If we're likely to be lowest, take more risks to improve
    if (riskOfBeingLowest > 0.6 && handVal < 19) return 'hit';
    
    // Conservative if we're safely above others
    if (handVal > lowestOtherHand + 2) return 'stand';
    
    // Aggressive in late game to avoid being lowest
    if (isLateGame && handVal <= lowestOtherHand && handVal < 20) return 'hit';
    
    // Default: try to stay above average
    return handVal < averageOtherHand && handVal < 18 ? 'hit' : 'stand';
  }
}


function calculateRiskOfBeingLowest(myHand, otherHands, isLateGame) {
  if (otherHands.length === 0) return 0;
  
  const lowerHands = otherHands.filter(hand => hand < myHand).length;
  const equalHands = otherHands.filter(hand => hand === myHand).length;
  const totalHands = otherHands.length;
  
  // Risk increases if fewer hands are below us
  const baseRisk = (totalHands - lowerHands) / totalHands;
  
  // Equal hands create 50% chance of being selected
  const equalRisk = equalHands > 0 ? 0.5 : 0;
  
  // Late game increases risk
  const lateGameMultiplier = isLateGame ? 1.3 : 1.0;
  
  return Math.min(1.0, (baseRisk + equalRisk) * lateGameMultiplier);
}


function getBotRouletteChoice(bot, gameState) {
  const { difficulty } = bot;
  const eliminationMode = gameState.rules?.eliminationMode || 'standard';
  
  let useSecondChance = false;
  let timing = 'pullNow';
  
  // 🎯 NEW: Mode-aware Second Chance Card usage
  if (bot.hasSecondChance && !bot.secondChanceUsed) {
    if (eliminationMode === 'lowestHand') {
      // In Lowest-Hand Mode, Second Chance is more valuable since selection is predictable
      // Bots should be more strategic about when to use it
      const myHandValue = handValue(bot.hand);
      const alivePlayers = Object.values(gameState.players).filter(p => p.alive && !p.spectator);
      const otherPlayers = alivePlayers.filter(p => p.id !== bot.id);
      const otherHandValues = otherPlayers.map(p => handValue(p.hand));
      const lowestOtherHand = otherHandValues.length > 0 ? Math.min(...otherHandValues) : 21;
      
      // Use Second Chance if we have the lowest or tied for lowest hand
      const hasLowestHand = myHandValue <= lowestOtherHand;
      
      if (difficulty === 'easy') {
        // Easy bots: Use if they have lowest hand (60% chance)
        useSecondChance = hasLowestHand && Math.random() < 0.6;
      } else if (difficulty === 'normal') {
        // Normal bots: More strategic - use if lowest or very close (80% chance)
        const isVeryLow = myHandValue <= lowestOtherHand + 1;
        useSecondChance = isVeryLow && Math.random() < 0.8;
      } else { // hard
        // Hard bots: Highly strategic - almost always use if they have lowest hand
        useSecondChance = hasLowestHand && Math.random() < 0.9;
      }
      
      console.log(`[BOT AI] ${bot.name} Lowest-Hand Mode roulette: myHand=${myHandValue}, lowestOther=${lowestOtherHand}, hasLowest=${hasLowestHand}, useSecondChance=${useSecondChance}`);
      
    } else {
      // Standard Mode: Original logic
      // Easy bots: rarely use it (20% chance)
      // Normal bots: sometimes use it (50% chance)  
      // Hard bots: strategically use it (70% chance)
      const useChance = difficulty === 'easy' ? 0.2 : difficulty === 'normal' ? 0.5 : 0.7;
      useSecondChance = Math.random() < useChance;
      
      console.log(`[BOT AI] ${bot.name} Standard Mode roulette: useChance=${useChance}, useSecondChance=${useSecondChance}`);
    }
  }
  
  // Timing decision (mostly cosmetic)
  if (difficulty !== 'easy' && Math.random() < 0.3) {
    timing = 'spinChamber';
  }
  
  return { useSecondChance, timing };
}
