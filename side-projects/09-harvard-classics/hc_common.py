"""Shared helpers for the Harvard Classics oracle and daily reader.

Everything here is Python 3.11 standard library only: paths, index loading,
tokenising, a small stopword list, a suffix-stripping stemmer, and the mood
lexicon that expands oracle queries.
"""
import json
import os
import re
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
VOLUMES_PATH = os.path.join(HERE, "volumes.json")
INDEX_PATH = os.path.join(DATA_DIR, "index.json")
SAMPLE_INDEX_PATH = os.path.join(DATA_DIR, "sample_index.json")
CALENDAR_PATH = os.path.join(DATA_DIR, "calendar.json")


def load_volumes():
    with open(VOLUMES_PATH, encoding="utf-8") as f:
        return json.load(f)["volumes"]


def find_index_path(prefer_sample=False):
    """The full index when fetch.py has built it, otherwise the bundled sample."""
    if not prefer_sample and os.path.exists(INDEX_PATH):
        return INDEX_PATH
    if os.path.exists(SAMPLE_INDEX_PATH):
        return SAMPLE_INDEX_PATH
    return None


def load_index(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --- text normalisation -----------------------------------------------------

STOPWORDS = set("""
a an and are as at be been but by for from had has have he her his i if in into
is it its me my no nor not of on or our she so than that the their them then
there these they this those thou thy thee to too was we were what when which who
whom will with would you your ye yet upon shall unto also very any all can
could did do does done how more most much such some only than
""".split())

_WORD_RE = re.compile(r"[a-z]+")


def stem(word):
    """A deliberately small suffix stripper. It only needs to make query words
    and passage words agree, not to be linguistically right."""
    if len(word) <= 3:
        return word
    for suffix, keep in (("iness", 1), ("ness", 0), ("ments", 0), ("ment", 0),
                         ("fully", 0), ("ingly", 0), ("ing", 0), ("edly", 0),
                         ("ies", "y"), ("ied", "y"), ("eth", 0), ("est", 0),
                         ("ers", 0), ("er", 0), ("ed", 0), ("es", 0), ("ly", 0),
                         ("s", 0)):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            base = word[: -len(suffix)]
            if isinstance(keep, str):
                base += keep
            # "hoping" -> "hop", "hope" -> "hop": drop a trailing e as well
            if base.endswith("e") and len(base) > 3:
                base = base[:-1]
            return base
    if word.endswith("e") and len(word) > 4:
        return word[:-1]
    return word


def tokenize(text):
    """Lowercase letters only, stopwords dropped, stems returned."""
    out = []
    for w in _WORD_RE.findall(text.lower()):
        if len(w) < 3 or w in STOPWORDS:
            continue
        out.append(stem(w))
    return out


# --- mood lexicon -------------------------------------------------------------
# A query word that matches a key (after stemming) is expanded with the listed
# related words at a lower weight. Keys and values are plain words; they are
# stemmed at use time so the list stays readable.
LEXICON = {
    "courage": ["brave", "valor", "valour", "bold", "fear", "danger", "heart", "fortitude"],
    "brave": ["courage", "valor", "bold", "fear", "danger"],
    "fear": ["afraid", "terror", "dread", "courage", "danger", "trembling"],
    "grief": ["sorrow", "mourn", "loss", "tears", "weep", "lament", "death"],
    "sorrow": ["grief", "mourn", "loss", "tears", "weep", "sad", "affliction"],
    "sad": ["sorrow", "grief", "melancholy", "weep", "heavy"],
    "loss": ["grief", "sorrow", "mourn", "death", "gone"],
    "death": ["die", "mortal", "grave", "dead", "soul", "immortal", "end"],
    "love": ["beloved", "affection", "heart", "passion", "tender", "dear", "friendship"],
    "friend": ["friendship", "companion", "faithful", "affection", "trust"],
    "friendship": ["friend", "companion", "affection", "faithful", "virtue"],
    "anger": ["wrath", "rage", "passion", "temper", "fury", "resentment", "patience"],
    "patience": ["endure", "bear", "suffer", "wait", "calm", "steadfast"],
    "hope": ["expect", "future", "trust", "promise", "faith", "despair"],
    "despair": ["hope", "misery", "wretched", "hopeless", "sorrow"],
    "wisdom": ["wise", "prudence", "knowledge", "understanding", "counsel", "philosophy"],
    "knowledge": ["learning", "understanding", "wisdom", "truth", "study", "science"],
    "truth": ["true", "false", "honest", "knowledge", "reason"],
    "restless": ["unquiet", "wander", "anxious", "peace", "rest", "quiet", "calm", "still", "trouble"],
    "anxious": ["anxiety", "care", "worry", "fear", "trouble", "restless", "peace"],
    "calm": ["quiet", "peace", "tranquil", "rest", "still", "serene", "content"],
    "peace": ["calm", "quiet", "rest", "tranquil", "war", "content"],
    "happy": ["happiness", "joy", "content", "pleasure", "cheerful", "delight"],
    "joy": ["happy", "delight", "pleasure", "gladness", "rejoice", "cheerful"],
    "money": ["wealth", "riches", "gold", "poverty", "gain", "fortune", "expense"],
    "wealth": ["money", "riches", "gold", "poverty", "fortune", "gain"],
    "poverty": ["poor", "wealth", "riches", "want", "need"],
    "work": ["labor", "labour", "toil", "industry", "diligence", "idle", "business"],
    "lazy": ["idle", "sloth", "indolence", "diligence", "industry", "work"],
    "time": ["hour", "day", "year", "age", "haste", "delay", "moment"],
    "nature": ["earth", "sea", "sky", "field", "wood", "river", "mountain", "wild"],
    "solitude": ["alone", "lonely", "retire", "quiet", "silence", "company"],
    "lonely": ["alone", "solitude", "solitary", "company", "friend"],
    "study": ["learning", "book", "read", "knowledge", "student", "school"],
    "ambition": ["glory", "honor", "honour", "fame", "power", "greatness", "pride"],
    "pride": ["proud", "vanity", "humility", "humble", "ambition"],
    "humble": ["humility", "modest", "lowly", "pride", "meek"],
    "doubt": ["uncertain", "question", "belief", "faith", "skeptic", "reason"],
    "faith": ["belief", "believe", "god", "trust", "religion", "doubt"],
    "god": ["divine", "heaven", "lord", "providence", "prayer", "faith"],
    "virtue": ["good", "honest", "just", "vice", "temperance", "moral"],
    "justice": ["just", "law", "right", "wrong", "injustice", "equal"],
    "liberty": ["freedom", "free", "tyranny", "slavery", "independence"],
    "freedom": ["liberty", "free", "tyranny", "slavery", "independence"],
    "war": ["battle", "army", "soldier", "enemy", "peace", "sword", "victory"],
    "beauty": ["beautiful", "fair", "lovely", "grace", "sublime", "delight"],
    "old": ["age", "aged", "years", "youth", "elder"],
    "youth": ["young", "old", "age", "years"],
    "sleep": ["dream", "rest", "night", "wake", "slumber"],
    "dream": ["sleep", "vision", "night", "fancy", "imagination"],
    "travel": ["journey", "voyage", "wander", "road", "sea", "country"],
    "sea": ["ocean", "ship", "wave", "sail", "voyage", "shore"],
    "change": ["fortune", "chance", "alter", "new", "vary"],
    "habit": ["custom", "practice", "use", "manner", "discipline"],
    "advice": ["counsel", "advise", "wisdom", "warn", "instruct"],
    "decision": ["choose", "choice", "resolve", "judgment", "counsel"],
    "purpose": ["end", "aim", "design", "intent", "resolve", "meaning"],
    "meaning": ["purpose", "sense", "end", "life", "understand"],
    "tired": ["weary", "rest", "sleep", "labor", "fatigue"],
    "sick": ["illness", "disease", "health", "physician", "body", "pain"],
    "pain": ["suffer", "grief", "ache", "hurt", "endure"],
    "food": ["eat", "drink", "feast", "hunger", "appetite", "temperance"],
}
