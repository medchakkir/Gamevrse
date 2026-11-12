Object.assign(module.exports, { createDeck, shuffle, handValue }); // function declarations are hoisted, so cyclic requires resolve





function createDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  return suits.flatMap(s => ranks.map(r => ({ rank: r, suit: s })));
}


function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}


function handValue(hand = []) {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { aces++; total += 11; }
    else if (['K','Q','J'].includes(c.rank)) total += 10;
    else total += parseInt(c.rank, 10);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}
