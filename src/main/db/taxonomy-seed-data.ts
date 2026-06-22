// Official AAMC MCAT content outline encoded as plain data.
// Source: AAMC "What's on the MCAT Exam?" content outline.
// Coverage: 4 sections, 10 foundational concepts, 31 content categories, 3 CARS skills.
// Topics (the leaf level) are intentionally NOT seeded here yet.

export interface TaxonomySeedNode {
  id: string
  kind: 'section' | 'foundational_concept' | 'content_category' | 'skill' | 'topic'
  code: string
  title: string
  parentId: string | null
}

export const taxonomySeed: TaxonomySeedNode[] = [
  // ── Sections ────────────────────────────────────────────────────────────
  {
    id: 'section:chem-phys',
    kind: 'section',
    code: 'chem-phys',
    title: 'Chemical and Physical Foundations of Biological Systems',
    parentId: null
  },
  {
    id: 'section:cars',
    kind: 'section',
    code: 'cars',
    title: 'Critical Analysis and Reasoning Skills',
    parentId: null
  },
  {
    id: 'section:bio-biochem',
    kind: 'section',
    code: 'bio-biochem',
    title: 'Biological and Biochemical Foundations of Living Systems',
    parentId: null
  },
  {
    id: 'section:psych-soc',
    kind: 'section',
    code: 'psych-soc',
    title: 'Psychological, Social, and Biological Foundations of Behavior',
    parentId: null
  },

  // ── Foundational Concepts ───────────────────────────────────────────────
  // FC1–FC3 → Biological and Biochemical Foundations of Living Systems
  {
    id: 'fc:1',
    kind: 'foundational_concept',
    code: '1',
    title:
      'Biomolecules have unique properties that determine how they contribute to the structure and function of cells, and how they participate in the processes necessary to maintain life.',
    parentId: 'section:bio-biochem'
  },
  {
    id: 'fc:2',
    kind: 'foundational_concept',
    code: '2',
    title:
      'Highly organized assemblies of molecules, cells, and organs interact to carry out the functions of living organisms.',
    parentId: 'section:bio-biochem'
  },
  {
    id: 'fc:3',
    kind: 'foundational_concept',
    code: '3',
    title:
      'Complex systems of tissues and organs sense the internal and external environments of multicellular organisms, and through integrated functioning, maintain a stable internal environment within an ever-changing external environment.',
    parentId: 'section:bio-biochem'
  },
  // FC4–FC5 → Chemical and Physical Foundations of Biological Systems
  {
    id: 'fc:4',
    kind: 'foundational_concept',
    code: '4',
    title:
      'Complex living organisms transport materials, sense their environment, process signals, and respond to changes using processes that can be understood in terms of physical principles.',
    parentId: 'section:chem-phys'
  },
  {
    id: 'fc:5',
    kind: 'foundational_concept',
    code: '5',
    title:
      'The principles that govern chemical interactions and reactions form the basis for a broader understanding of the molecular dynamics of living systems.',
    parentId: 'section:chem-phys'
  },
  // FC6–FC10 → Psychological, Social, and Biological Foundations of Behavior
  {
    id: 'fc:6',
    kind: 'foundational_concept',
    code: '6',
    title: 'Biological, psychological, and sociocultural factors influence the ways that individuals perceive, think about, and react to the world.',
    parentId: 'section:psych-soc'
  },
  {
    id: 'fc:7',
    kind: 'foundational_concept',
    code: '7',
    title: 'Biological, psychological, and sociocultural factors influence behavior and behavior change.',
    parentId: 'section:psych-soc'
  },
  {
    id: 'fc:8',
    kind: 'foundational_concept',
    code: '8',
    title: 'Psychological, sociocultural, and biological factors influence the way we think about ourselves and others, as well as how we interact with others.',
    parentId: 'section:psych-soc'
  },
  {
    id: 'fc:9',
    kind: 'foundational_concept',
    code: '9',
    title: 'Cultural and social differences influence well-being.',
    parentId: 'section:psych-soc'
  },
  {
    id: 'fc:10',
    kind: 'foundational_concept',
    code: '10',
    title: 'Social stratification and access to resources influence well-being.',
    parentId: 'section:psych-soc'
  },

  // ── Content Categories ──────────────────────────────────────────────────
  // FC1 (1A–1D)
  {
    id: 'cc:1A',
    kind: 'content_category',
    code: '1A',
    title: 'Structure and function of proteins and their constituent amino acids',
    parentId: 'fc:1'
  },
  {
    id: 'cc:1B',
    kind: 'content_category',
    code: '1B',
    title: 'Transmission of genetic information from the gene to the protein',
    parentId: 'fc:1'
  },
  {
    id: 'cc:1C',
    kind: 'content_category',
    code: '1C',
    title: 'Transmission of heritable information from generation to generation and the processes that increase genetic diversity',
    parentId: 'fc:1'
  },
  {
    id: 'cc:1D',
    kind: 'content_category',
    code: '1D',
    title: 'Principles of bioenergetics and fuel molecule metabolism',
    parentId: 'fc:1'
  },
  // FC2 (2A–2C)
  {
    id: 'cc:2A',
    kind: 'content_category',
    code: '2A',
    title: 'Assemblies of molecules, cells, and groups of cells within single cellular and multicellular organisms',
    parentId: 'fc:2'
  },
  {
    id: 'cc:2B',
    kind: 'content_category',
    code: '2B',
    title: 'The structure, growth, physiology, and genetics of prokaryotes and viruses',
    parentId: 'fc:2'
  },
  {
    id: 'cc:2C',
    kind: 'content_category',
    code: '2C',
    title: 'Processes of cell division, differentiation, and specialization',
    parentId: 'fc:2'
  },
  // FC3 (3A–3B)
  {
    id: 'cc:3A',
    kind: 'content_category',
    code: '3A',
    title: 'Structure and functions of the nervous and endocrine systems and ways that these systems coordinate the organ systems',
    parentId: 'fc:3'
  },
  {
    id: 'cc:3B',
    kind: 'content_category',
    code: '3B',
    title: 'Structure and integrative functions of the main organ systems',
    parentId: 'fc:3'
  },
  // FC4 (4A–4E)
  {
    id: 'cc:4A',
    kind: 'content_category',
    code: '4A',
    title: 'Translational motion, forces, work, energy, and equilibrium in living systems',
    parentId: 'fc:4'
  },
  {
    id: 'cc:4B',
    kind: 'content_category',
    code: '4B',
    title: 'Importance of fluids for the circulation of blood, gas movement, and gas exchange',
    parentId: 'fc:4'
  },
  {
    id: 'cc:4C',
    kind: 'content_category',
    code: '4C',
    title: 'Electrochemistry and electrical circuits and their elements',
    parentId: 'fc:4'
  },
  {
    id: 'cc:4D',
    kind: 'content_category',
    code: '4D',
    title: 'How light and sound interact with matter',
    parentId: 'fc:4'
  },
  {
    id: 'cc:4E',
    kind: 'content_category',
    code: '4E',
    title: 'Atoms, nuclear decay, electronic structure, and atomic chemical behavior',
    parentId: 'fc:4'
  },
  // FC5 (5A–5E)
  {
    id: 'cc:5A',
    kind: 'content_category',
    code: '5A',
    title: 'Unique nature of water and its solutions',
    parentId: 'fc:5'
  },
  {
    id: 'cc:5B',
    kind: 'content_category',
    code: '5B',
    title: 'Nature of molecules and intermolecular interactions',
    parentId: 'fc:5'
  },
  {
    id: 'cc:5C',
    kind: 'content_category',
    code: '5C',
    title: 'Separation and purification methods',
    parentId: 'fc:5'
  },
  {
    id: 'cc:5D',
    kind: 'content_category',
    code: '5D',
    title: 'Structure, function, and reactivity of biologically relevant molecules',
    parentId: 'fc:5'
  },
  {
    id: 'cc:5E',
    kind: 'content_category',
    code: '5E',
    title: 'Principles of chemical thermodynamics and kinetics',
    parentId: 'fc:5'
  },
  // FC6 (6A–6C)
  {
    id: 'cc:6A',
    kind: 'content_category',
    code: '6A',
    title: 'Sensing the environment',
    parentId: 'fc:6'
  },
  {
    id: 'cc:6B',
    kind: 'content_category',
    code: '6B',
    title: 'Making sense of the environment',
    parentId: 'fc:6'
  },
  {
    id: 'cc:6C',
    kind: 'content_category',
    code: '6C',
    title: 'Responding to the world',
    parentId: 'fc:6'
  },
  // FC7 (7A–7C)
  {
    id: 'cc:7A',
    kind: 'content_category',
    code: '7A',
    title: 'Individual influences on behavior',
    parentId: 'fc:7'
  },
  {
    id: 'cc:7B',
    kind: 'content_category',
    code: '7B',
    title: 'Social processes that influence human behavior',
    parentId: 'fc:7'
  },
  {
    id: 'cc:7C',
    kind: 'content_category',
    code: '7C',
    title: 'Attitude and behavior change',
    parentId: 'fc:7'
  },
  // FC8 (8A–8C)
  {
    id: 'cc:8A',
    kind: 'content_category',
    code: '8A',
    title: 'Self-identity',
    parentId: 'fc:8'
  },
  {
    id: 'cc:8B',
    kind: 'content_category',
    code: '8B',
    title: 'Social thinking',
    parentId: 'fc:8'
  },
  {
    id: 'cc:8C',
    kind: 'content_category',
    code: '8C',
    title: 'Social interactions',
    parentId: 'fc:8'
  },
  // FC9 (9A–9B)
  {
    id: 'cc:9A',
    kind: 'content_category',
    code: '9A',
    title: 'Understanding social structure',
    parentId: 'fc:9'
  },
  {
    id: 'cc:9B',
    kind: 'content_category',
    code: '9B',
    title: 'Demographic characteristics and processes',
    parentId: 'fc:9'
  },
  // FC10 (10A)
  {
    id: 'cc:10A',
    kind: 'content_category',
    code: '10A',
    title: 'Social inequality',
    parentId: 'fc:10'
  },

  // ── CARS Skills ─────────────────────────────────────────────────────────
  {
    id: 'skill:cars-foundations-of-comprehension',
    kind: 'skill',
    code: 'cars-foundations',
    title: 'Foundations of Comprehension',
    parentId: 'section:cars'
  },
  {
    id: 'skill:cars-reasoning-within-the-text',
    kind: 'skill',
    code: 'cars-reasoning-within',
    title: 'Reasoning Within the Text',
    parentId: 'section:cars'
  },
  {
    id: 'skill:cars-reasoning-beyond-the-text',
    kind: 'skill',
    code: 'cars-reasoning-beyond',
    title: 'Reasoning Beyond the Text',
    parentId: 'section:cars'
  }
]
