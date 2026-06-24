import type { DisciplineKey } from '../../../shared/dto'

export const DISCIPLINES: { slug: DisciplineKey; title: string }[] = [
  { slug: 'gen-chem', title: 'General Chemistry' },
  { slug: 'o-chem', title: 'Organic Chemistry' },
  { slug: 'biology', title: 'Biology' },
  { slug: 'biochem', title: 'Biochemistry' },
  { slug: 'behavioral-sci', title: 'Behavioral Sciences' }
]

export interface TopicSeed {
  slug: string
  discipline: DisciplineKey
  title: string
  aamcCodes: string[]
}

export const TOPICS: TopicSeed[] = [
  // General Chemistry
  { slug: 'gen-chem.atomic-theory', discipline: 'gen-chem', title: 'Atomic Theory & Chemical Composition', aamcCodes: ['4E'] },
  { slug: 'gen-chem.chemical-interactions', discipline: 'gen-chem', title: 'Interactions of Chemical Substances', aamcCodes: ['5B', '5A'] },
  { slug: 'gen-chem.thermo-kinetics-gas', discipline: 'gen-chem', title: 'Thermodynamics, Kinetics & Gas Laws', aamcCodes: ['5E', '4A'] },
  { slug: 'gen-chem.solutions-electrochem', discipline: 'gen-chem', title: 'Solutions & Electrochemistry', aamcCodes: ['5A', '4C'] },
  // Organic Chemistry
  { slug: 'o-chem.intro', discipline: 'o-chem', title: 'Introduction to Organic Chemistry', aamcCodes: ['5D'] },
  { slug: 'o-chem.functional-groups', discipline: 'o-chem', title: 'Functional Groups & Their Reactions', aamcCodes: ['5D'] },
  { slug: 'o-chem.separations-spectroscopy', discipline: 'o-chem', title: 'Separations, Spectroscopy & Analytical Methods', aamcCodes: ['5C', '5D'] },
  // Biology
  { slug: 'biology.molecular-biology', discipline: 'biology', title: 'Molecular Biology', aamcCodes: ['1B'] },
  { slug: 'biology.cellular-biology', discipline: 'biology', title: 'Cellular Biology', aamcCodes: ['2A', '2C'] },
  { slug: 'biology.genetics-evolution', discipline: 'biology', title: 'Genetics & Evolution', aamcCodes: ['1C', '1B'] },
  { slug: 'biology.reproduction', discipline: 'biology', title: 'Reproduction', aamcCodes: ['2C', '3B'] },
  { slug: 'biology.endocrine-nervous', discipline: 'biology', title: 'Endocrine & Nervous Systems', aamcCodes: ['3A'] },
  { slug: 'biology.circulation-respiration', discipline: 'biology', title: 'Circulation & Respiration', aamcCodes: ['3B', '4B'] },
  { slug: 'biology.digestion-excretion', discipline: 'biology', title: 'Digestion & Excretion', aamcCodes: ['3B'] },
  { slug: 'biology.musculoskeletal', discipline: 'biology', title: 'Musculoskeletal System', aamcCodes: ['3B', '4A'] },
  { slug: 'biology.skin-immune', discipline: 'biology', title: 'Skin & Immune Systems', aamcCodes: ['3B'] },
  // Biochemistry
  { slug: 'biochem.amino-acids-proteins', discipline: 'biochem', title: 'Amino Acids & Proteins', aamcCodes: ['1A'] },
  { slug: 'biochem.enzymes', discipline: 'biochem', title: 'Enzymes', aamcCodes: ['1A'] },
  { slug: 'biochem.carbs-nucleotides-lipids', discipline: 'biochem', title: 'Carbs, Nucleotides & Lipids', aamcCodes: ['1D', '5D'] },
  { slug: 'biochem.metabolic-reactions', discipline: 'biochem', title: 'Metabolic Reactions', aamcCodes: ['1D'] },
  // Behavioral Sciences
  { slug: 'behavioral-sci.demographics-social-structure', discipline: 'behavioral-sci', title: 'Demographics & Social Structure', aamcCodes: ['9A', '9B', '10A'] },
  { slug: 'behavioral-sci.identity-social-interaction', discipline: 'behavioral-sci', title: 'Identity & Social Interaction', aamcCodes: ['7B', '8A', '8B', '8C'] },
  { slug: 'behavioral-sci.learning-memory-cognition', discipline: 'behavioral-sci', title: 'Learning, Memory & Cognition', aamcCodes: ['6B', '7A'] },
  { slug: 'behavioral-sci.motivation-emotion-personality', discipline: 'behavioral-sci', title: 'Motivation, Emotion, Attitudes, Personality & Stress', aamcCodes: ['6C', '7A', '7C'] },
  { slug: 'behavioral-sci.sensation-perception-consciousness', discipline: 'behavioral-sci', title: 'Sensation, Perception & Consciousness', aamcCodes: ['6A', '6B'] }
]

// AAMC content-category reference (codes + titles) — used to validate the mapping.
export const AAMC_CONTENT_CATEGORIES: { code: string; title: string }[] = [
  { code: '1A', title: 'Structure and function of proteins and their constituent amino acids' },
  { code: '1B', title: 'Transmission of genetic information from the gene to the protein' },
  { code: '1C', title: 'Transmission of heritable information from generation to generation' },
  { code: '1D', title: 'Principles of bioenergetics and fuel molecule metabolism' },
  { code: '2A', title: 'Assemblies of molecules, cells, and groups of cells within organisms' },
  { code: '2B', title: 'Structure, growth, physiology, and genetics of prokaryotes and viruses' },
  { code: '2C', title: 'Processes of cell division, differentiation, and specialization' },
  { code: '3A', title: 'Structure and functions of the nervous and endocrine systems' },
  { code: '3B', title: 'Structure and integrative functions of the main organ systems' },
  { code: '4A', title: 'Translational motion, forces, work, energy, and equilibrium' },
  { code: '4B', title: 'Importance of fluids for circulation, gas movement, and gas exchange' },
  { code: '4C', title: 'Electrochemistry and electrical circuits and their elements' },
  { code: '4D', title: 'How light and sound interact with matter' },
  { code: '4E', title: 'Atoms, nuclear decay, electronic structure, and atomic chemical behavior' },
  { code: '5A', title: 'Unique nature of water and its solutions' },
  { code: '5B', title: 'Nature of molecules and intermolecular interactions' },
  { code: '5C', title: 'Separation and purification methods' },
  { code: '5D', title: 'Structure, function, and reactivity of biologically-relevant molecules' },
  { code: '5E', title: 'Principles of chemical thermodynamics and kinetics' },
  { code: '6A', title: 'Sensing the environment' },
  { code: '6B', title: 'Making sense of the environment' },
  { code: '6C', title: 'Responding to the world' },
  { code: '7A', title: 'Individual influences on behavior' },
  { code: '7B', title: 'Social processes that influence human behavior' },
  { code: '7C', title: 'Attitude and behavior change' },
  { code: '8A', title: 'Self-identity' },
  { code: '8B', title: 'Social thinking' },
  { code: '8C', title: 'Social interactions' },
  { code: '9A', title: 'Understanding social structure' },
  { code: '9B', title: 'Demographic characteristics and processes' },
  { code: '10A', title: 'Social inequality' }
]

export const AAMC_CODES: ReadonlySet<string> = new Set(AAMC_CONTENT_CATEGORIES.map((c) => c.code))
