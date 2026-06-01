/**
 * Map an ISO-639-1 (2-letter) language code to its ISO-639-2/B (3-letter) code
 * for the Stremio subtitles `lang` field. Input is lower-cased + trimmed.
 * Unknown codes (and codes already in 3-letter form) pass through unchanged,
 * so an unexpected value is never relabelled as the wrong language.
 */
const ISO_639_1_TO_2: Record<string, string> = {
  // Source: https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
  // ISO-639-2/B codes used throughout (B≠T cases use /B variant)
  'aa': 'aar', // Afar
  'ab': 'abk', // Abkhazian
  'ae': 'ave', // Avestan
  'af': 'afr', // Afrikaans
  'ak': 'aka', // Akan
  'am': 'amh', // Amharic
  'an': 'arg', // Aragonese
  'ar': 'ara', // Arabic
  'as': 'asm', // Assamese
  'av': 'ava', // Avaric
  'ay': 'aym', // Aymara
  'az': 'aze', // Azerbaijani
  'ba': 'bak', // Bashkir
  'be': 'bel', // Belarusian
  'bg': 'bul', // Bulgarian
  'bi': 'bis', // Bislama
  'bm': 'bam', // Bambara
  'bn': 'ben', // Bengali
  'bo': 'tib', // Tibetan (B=tib, T=bod)
  'br': 'bre', // Breton
  'bs': 'bos', // Bosnian
  'ca': 'cat', // Catalan
  'ce': 'che', // Chechen
  'ch': 'cha', // Chamorro
  'co': 'cos', // Corsican
  'cr': 'cre', // Cree
  'cs': 'cze', // Czech (B=cze, T=ces)
  'cu': 'chu', // Church Slavic
  'cv': 'chv', // Chuvash
  'cy': 'wel', // Welsh (B=wel, T=cym)
  'da': 'dan', // Danish
  'de': 'ger', // German (B=ger, T=deu)
  'dv': 'div', // Divehi
  'dz': 'dzo', // Dzongkha
  'ee': 'ewe', // Ewe
  'el': 'gre', // Greek (B=gre, T=ell)
  'en': 'eng', // English
  'eo': 'epo', // Esperanto
  'es': 'spa', // Spanish
  'et': 'est', // Estonian
  'eu': 'baq', // Basque (B=baq, T=eus)
  'fa': 'per', // Persian (B=per, T=fas)
  'ff': 'ful', // Fulah
  'fi': 'fin', // Finnish
  'fj': 'fij', // Fijian
  'fo': 'fao', // Faroese
  'fr': 'fre', // French (B=fre, T=fra)
  'fy': 'fry', // Western Frisian
  'ga': 'gle', // Irish
  'gd': 'gla', // Scottish Gaelic
  'gl': 'glg', // Galician
  'gn': 'grn', // Guaraní
  'gu': 'guj', // Gujarati
  'gv': 'glv', // Manx
  'ha': 'hau', // Hausa
  'he': 'heb', // Hebrew
  'hi': 'hin', // Hindi
  'ho': 'hmo', // Hiri Motu
  'hr': 'hrv', // Croatian
  'ht': 'hat', // Haitian Creole
  'hu': 'hun', // Hungarian
  'hy': 'arm', // Armenian (B=arm, T=hye)
  'hz': 'her', // Herero
  'ia': 'ina', // Interlingua
  'id': 'ind', // Indonesian
  'ie': 'ile', // Interlingue
  'ig': 'ibo', // Igbo
  'ii': 'iii', // Sichuan Yi
  'ik': 'ipk', // Inupiaq
  'io': 'ido', // Ido
  'is': 'ice', // Icelandic (B=ice, T=isl)
  'it': 'ita', // Italian
  'iu': 'iku', // Inuktitut
  'ja': 'jpn', // Japanese
  'jv': 'jav', // Javanese
  'ka': 'geo', // Georgian (B=geo, T=kat)
  'kg': 'kon', // Kongo
  'ki': 'kik', // Kikuyu
  'kj': 'kua', // Kwanyama
  'kk': 'kaz', // Kazakh
  'kl': 'kal', // Kalaallisut
  'km': 'khm', // Khmer
  'kn': 'kan', // Kannada
  'ko': 'kor', // Korean
  'kr': 'kau', // Kanuri
  'ks': 'kas', // Kashmiri
  'ku': 'kur', // Kurdish
  'kv': 'kom', // Komi
  'kw': 'cor', // Cornish
  'ky': 'kir', // Kirghiz
  'la': 'lat', // Latin
  'lb': 'ltz', // Luxembourgish
  'lg': 'lug', // Ganda
  'li': 'lim', // Limburgish
  'ln': 'lin', // Lingala
  'lo': 'lao', // Lao
  'lt': 'lit', // Lithuanian
  'lu': 'lub', // Luba-Katanga
  'lv': 'lav', // Latvian
  'mg': 'mlg', // Malagasy
  'mh': 'mah', // Marshallese
  'mi': 'mao', // Māori (B=mao, T=mri)
  'mk': 'mac', // Macedonian (B=mac, T=mkd)
  'ml': 'mal', // Malayalam
  'mn': 'mon', // Mongolian
  'mr': 'mar', // Marathi
  'ms': 'may', // Malay (B=may, T=msa)
  'mt': 'mlt', // Maltese
  'my': 'bur', // Burmese (B=bur, T=mya)
  'na': 'nau', // Nauru
  'nb': 'nob', // Norwegian Bokmål
  'nd': 'nde', // North Ndebele
  'ne': 'nep', // Nepali
  'ng': 'ndo', // Ndonga
  'nl': 'dut', // Dutch (B=dut, T=nld)
  'nn': 'nno', // Norwegian Nynorsk
  'no': 'nor', // Norwegian
  'nr': 'nbl', // South Ndebele
  'nv': 'nav', // Navajo
  'ny': 'nya', // Chichewa
  'oc': 'oci', // Occitan
  'oj': 'oji', // Ojibwe
  'om': 'orm', // Oromo
  'or': 'ori', // Oriya
  'os': 'oss', // Ossetic
  'pa': 'pan', // Punjabi
  'pi': 'pli', // Pali
  'pl': 'pol', // Polish
  'ps': 'pus', // Pashto
  'pt': 'por', // Portuguese
  'qu': 'que', // Quechua
  'rm': 'roh', // Romansh
  'rn': 'run', // Kirundi
  'ro': 'rum', // Romanian (B=rum, T=ron)
  'ru': 'rus', // Russian
  'rw': 'kin', // Kinyarwanda
  'sa': 'san', // Sanskrit
  'sc': 'srd', // Sardinian
  'sd': 'snd', // Sindhi
  'se': 'sme', // Northern Sami
  'sg': 'sag', // Sango
  'si': 'sin', // Sinhalese
  'sk': 'slo', // Slovak (B=slo, T=slk)
  'sl': 'slv', // Slovenian
  'sm': 'smo', // Samoan
  'sn': 'sna', // Shona
  'so': 'som', // Somali
  'sq': 'alb', // Albanian (B=alb, T=sqi)
  'sr': 'srp', // Serbian (scc was the /B code but was withdrawn in 2008; srp is the surviving code)
  'ss': 'ssw', // Swati
  'st': 'sot', // Southern Sotho
  'su': 'sun', // Sundanese
  'sv': 'swe', // Swedish
  'sw': 'swa', // Swahili
  'ta': 'tam', // Tamil
  'te': 'tel', // Telugu
  'tg': 'tgk', // Tajik
  'th': 'tha', // Thai
  'ti': 'tir', // Tigrinya
  'tk': 'tuk', // Turkmen
  'tl': 'tgl', // Tagalog
  'tn': 'tsn', // Tswana
  'to': 'ton', // Tonga
  'tr': 'tur', // Turkish
  'ts': 'tso', // Tsonga
  'tt': 'tat', // Tatar
  'tw': 'twi', // Twi
  'ty': 'tah', // Tahitian
  'ug': 'uig', // Uyghur
  'uk': 'ukr', // Ukrainian
  'ur': 'urd', // Urdu
  'uz': 'uzb', // Uzbek
  've': 'ven', // Venda
  'vi': 'vie', // Vietnamese
  'vo': 'vol', // Volapük
  'wa': 'wln', // Walloon
  'wo': 'wol', // Wolof
  'xh': 'xho', // Xhosa
  'yi': 'yid', // Yiddish
  'yo': 'yor', // Yoruba
  'za': 'zha', // Zhuang
  'zh': 'chi', // Chinese (B=chi, T=zho)
  'zu': 'zul', // Zulu
};

export function toIso639_2(code: string): string {
  const k = code.trim().toLowerCase();
  return ISO_639_1_TO_2[k] ?? k;
}
