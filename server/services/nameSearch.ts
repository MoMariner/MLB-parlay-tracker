/**
 * Nickname-aware player search. Neither upstream search expands nicknames:
 * ESPN lists "Matthew Stafford" and finds nothing for "matt stafford", and
 * MLB lists "Mike Trout" and finds nothing for "michael trout". So a
 * multi-word search also looks up the surname alone and keeps the players
 * whose first name could be the one typed.
 */

// A shared prefix already matches either way (Matt/Matthew, Chris/Christopher);
// these groups cover the nicknames that don't share one (Mike/Michael).
const NICKNAMES: string[][] = [
  'michael mike mikey', 'william will bill billy willie liam', 'robert rob bob bobby robbie',
  'richard rich rick ricky richie', 'james jim jimmy jamie', 'john jack johnny',
  'jonathan jon jonny johnny', 'joseph joe joey', 'anthony tony', 'andrew drew andy',
  'edward ed eddie ted teddy', 'theodore theo ted teddy', 'thomas tom tommy',
  'charles charlie chuck', 'nicholas nick nicky', 'matthew matt matty', 'daniel dan danny',
  'benjamin ben benny', 'samuel sam sammy', 'alexander alex xander', 'zachary zach zack zak',
  'jacob jake', 'nathan nathaniel nate', 'gabriel gabe', 'timothy tim timmy',
  'kenneth ken kenny', 'stephen steven steve', 'david dave davey', 'ronald ron ronnie',
  'donald don donnie', 'frederick fred freddie', 'lawrence larry', 'gerald jerry',
  'jeffrey geoffrey jeff', 'ezekiel zeke', 'eugene gene geno', 'terrance terrence terry',
  'randall randy', 'reginald reggie',
].map((group) => group.split(' '));

/** Lowercase, accents and punctuation dropped: "José" -> "jose", "T.J." -> "tj". */
export function normName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * "matt stafford" -> first "matt", surname "stafford". Null for a single
 * word, or while the surname is too short to search on its own.
 */
export function splitName(query: string): { first: string; surname: string } | null {
  const words = query.trim().split(/\s+/);
  if (words.length < 2) return null;
  const surname = words.slice(1).join(' ');
  return normName(words[0]) && normName(surname).length >= 2 ? { first: words[0], surname } : null;
}

/**
 * Could the typed first name be any of these? "matt" fits Matthew, "matthew"
 * fits Matt, "mike" fits Michael, and a partial "mik" fits all three.
 */
export function firstNameMatches(typed: string, names: Array<string | null | undefined>): boolean {
  const t = normName(typed);
  if (!t) return false;
  const forms = new Set([t]);
  for (const group of NICKNAMES) {
    if (group.some((n) => n.startsWith(t))) group.forEach((n) => forms.add(n));
  }
  return names.some((raw) => {
    const n = normName(raw ?? '');
    return n.length > 0 && [...forms].some((f) => f.startsWith(n) || n.startsWith(f));
  });
}

/** First occurrence wins, so direct hits keep their place ahead of nickname matches. */
export function uniqueBy<T>(items: T[], key: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
