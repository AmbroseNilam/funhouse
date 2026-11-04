// The words the content filter looks for, in ROT13 so nobody reads a list of slurs while working
// in this repository. Whole-word terms are short enough to appear inside ordinary words.

/** Hate terms long enough to match even with the letters run together. */
export const JOINED_HATE: string[] = ["avttre", "avttn", "avttref", "snttbg", "snttbgf", "xvxr", "xvxrf", "jrgonpx", "jrgonpxf", "genaal", "genaavrf", "ergneq", "ergneqf", "enturnq", "gbjryurnq", "ornare", "ornaref", "fnaqavttre", "puvanzna"];

/** Hate terms that only count as whole words. */
export const WORD_HATE: string[] = ["snt", "sntf", "fcvp", "fcvpf", "puvax", "puvaxf", "tbbx", "tbbxf", "pbba", "pbbaf", "cnxv", "cnxvf", "qlxr", "qlxrf", "anmv"];

/** Hate and self-harm phrases, matched with spacing tidied. */
export const HATE_PHRASES: string[] = ["urvy uvgyre", "tnf gur wrjf", "juvgr cbjre", "xvyy lbhefrys", "tb xvyy lbhefrys", "xlf", "unat lbhefrys", "enpr jne", "fvrt urvy", "svany fbyhgvba", "ubybpnhfg arire unccrarq"];

/** Explicit terms long enough to match with the letters run together. */
export const JOINED_SEXUAL: string[] = ["oybjwbo", "unaqwbo", "evzwbo", "qvyqb", "pernzcvr", "tnatonat", "phzfubg", "qrrcguebng", "znfgheongr", "znfgheongvat", "orfgvnyvgl", "vaprfg", "cbeauho", "kivqrbf", "cbeabtencul"];

/** Explicit terms that only count as whole words. */
export const WORD_SEXUAL: string[] = ["pbpx", "pbpxf", "qvpx", "qvpxf", "chffl", "phag", "phagf", "phz", "gvgf", "cbea", "nany", "encr", "encrq", "encvfg", "encvat", "betnfz", "ahqrf", "cravf", "intvan", "pyvg", "ubeal", "sryyngvb"];

/** Words for a child: blocked next to any word in SEXUAL_CONTEXT. */
export const MINOR_WORDS: string[] = ["puvyq", "puvyqera", "xvq", "xvqf", "zvabe", "zvabef", "haqrentr", "grra", "grraf", "grrantre", "fpubbytvey", "fpubbyobl", "gbqqyre", "cergrra", "onol", "onovrf", "vasnag", "obl", "oblf", "tvey", "tveyf"];

/** Words that turn a mention of a child into sexual content. */
export const SEXUAL_CONTEXT: string[] = ["frk", "frkl", "frkhny", "anxrq", "ahqr", "ahqrf", "ubeal", "cbea", "encr", "zbyrfg", "frqhpr"];

/** Terms that are about the sexual abuse of children on their own. */
export const MINOR_SEXUAL: string[] = ["ybyv", "ybyvgn", "fubgn", "crqb", "crqbf", "cnrqb", "crqbcuvyr", "cnrqbcuvyr", "wnvyonvg", "puvyqcbea", "zbyrfgre", "xvqqvr"];
