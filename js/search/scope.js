// The "Search by" vocabulary: title, person, discover, auto. Without it one phrase had to say both what is wanted and what kind of thing it is.

export const AUTO = "auto";
export const TITLE = "title";
export const PERSON = "person";
export const DISCOVER = "discover";

const ALIASES = {
  auto: AUTO, anything: AUTO, smart: AUTO, "": AUTO,
  title: TITLE, titles: TITLE, name: TITLE,
  movie: TITLE, "movie title": TITLE, "series title": TITLE, show: TITLE,
  person: PERSON, people: PERSON, actor: PERSON, actress: PERSON,
  cast: PERSON, crew: PERSON, director: PERSON,
  discover: DISCOVER, genre: DISCOVER, mood: DISCOVER,
  "genre & mood": DISCOVER, keyword: DISCOVER, browse: DISCOVER
};

export function clean(value) {
  return ALIASES[String(value == null ? "" : value).trim().toLowerCase()] || AUTO;
}

// Scopes where the phrase IS the search term, so TMDB can be asked directly with nothing interpreting it first.
export const TERM_SCOPES = [TITLE, PERSON];

const DEFINITIONS = [
  {
    value: AUTO,
    label: "Anything",
    hint: "Work out what I meant",
    placeholder: {
      movie: "Akshay Kumar and Suniel Shetty movies, bollywood romance, movies like Interstellar\u2026",
      tv: "Korean dramas, shows like Breaking Bad, best crime series\u2026"
    },
    examples: {
      movie: [
        ["Christopher Nolan movies", "Christopher Nolan"],
        ["Akshay Kumar and Suniel Shetty movies", "Akshay & Suniel"],
        ["Bollywood romantic movies", "Bollywood romance"],
        ["Korean thriller movies", "Korean thrillers"],
        ["Marvel movies", "Marvel"],
        ["Best sci fi movies", "Best sci-fi"],
        ["Movies like Interstellar", "Like Interstellar"],
        ["Time travel movies", "Time travel"],
        ["Best movies of 2025", "Best of 2025"]
      ],
      tv: [
        ["Best korean drama series", "Korean dramas"],
        ["Shows like Breaking Bad", "Like Breaking Bad"],
        ["Best crime series", "Crime series"],
        ["Netflix thriller series", "Netflix thrillers"],
        ["Indian web series", "Indian web series"],
        ["Anime series", "Anime"],
        ["Best comedy sitcoms", "Sitcoms"],
        ["Trending web series", "Trending now"],
        ["Best series of 2025", "Best of 2025"]
      ]
    }
  },
  {
    value: TITLE,
    label: "Title",
    hint: "The name of one movie or series",
    placeholder: {
      movie: "The Call, Interstellar, 3 Idiots, movies like Inception\u2026",
      tv: "Dark, Breaking Bad, Panchayat, shows like Severance\u2026"
    },
    examples: {
      movie: [
        ["The Call", "The Call"],
        ["Interstellar", "Interstellar"],
        ["3 Idiots", "3 Idiots"],
        ["Movies like Inception", "Like Inception"],
        ["The Dark Knight", "The Dark Knight"],
        ["Baahubali", "Baahubali"]
      ],
      tv: [
        ["Dark", "Dark"],
        ["Breaking Bad", "Breaking Bad"],
        ["Panchayat", "Panchayat"],
        ["Shows like Severance", "Like Severance"],
        ["The Office", "The Office"],
        ["Money Heist", "Money Heist"]
      ]
    }
  },
  {
    value: PERSON,
    label: "Person",
    hint: "An actor, director or creator - or several at once",
    placeholder: {
      movie: "Hrithik Roshan, Akshay Kumar and Suniel Shetty, Tom Cruise action\u2026",
      tv: "Vince Gilligan, Jeff Bridges shows, best Manoj Bajpayee series\u2026"
    },
    examples: {
      movie: [
        ["Hrithik Roshan", "Hrithik Roshan"],
        ["Akshay Kumar and Suniel Shetty comedy movies", "Akshay & Suniel"],
        ["Akshay Kumar comedy movies", "Akshay Kumar comedy"],
        ["Tom Cruise action films", "Tom Cruise action"],
        ["Directed by Rajkumar Hirani", "Rajkumar Hirani"],
        ["Best Alia Bhatt films", "Alia Bhatt"]
      ],
      tv: [
        ["Vince Gilligan", "Vince Gilligan"],
        ["Manoj Bajpayee series", "Manoj Bajpayee"],
        ["Pedro Pascal shows", "Pedro Pascal"],
        ["Created by Shonda Rhimes", "Shonda Rhimes"],
        ["Best Pankaj Tripathi web series", "Pankaj Tripathi"],
        ["Bryan Cranston", "Bryan Cranston"]
      ]
    }
  },
  {
    value: DISCOVER,
    label: "Genre & mood",
    hint: "A kind of title, not a name",
    placeholder: {
      movie: "Bollywood romance, best sci fi, time travel, 90s action\u2026",
      tv: "Korean thrillers, best crime, anime, Netflix mystery\u2026"
    },
    examples: {
      movie: [
        ["Bollywood romantic movies", "Bollywood romance"],
        ["Best sci fi movies", "Best sci-fi"],
        ["Time travel movies", "Time travel"],
        ["90s action movies", "90s action"],
        ["Korean thriller movies", "Korean thrillers"],
        ["Best movies of 2025", "Best of 2025"]
      ],
      tv: [
        ["Best korean drama series", "Korean dramas"],
        ["Netflix crime series", "Netflix crime"],
        ["Anime series", "Anime"],
        ["Indian web series", "Indian web series"],
        ["Best mystery series", "Mystery"],
        ["Best series of 2025", "Best of 2025"]
      ]
    }
  }
];

export function options() {
  return DEFINITIONS.map(entry => ({ ...entry }));
}

export function definitionFor(value) {
  const wanted = clean(value);
  return DEFINITIONS.find(entry => entry.value === wanted) || DEFINITIONS[0];
}
