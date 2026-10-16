module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
  testMatch: ['**/__tests__/**/*.unit.test.ts?(x)'],
  // En test, on force `preserveEnvVars: true` au caller babel-jest pour que
  // `babel-preset-expo` N'INLINE PAS les `process.env.EXPO_PUBLIC_*` au
  // build. Cela permet de tester le comportement runtime de la chaîne de
  // priorité (env > extra > défaut) sans dépendre d'une valeur figée au
  // moment de la transformation babel. En build de production (APK Metro),
  // l'inlining est actif et la valeur d'env est figée au bundle — c'est
  // exactement le comportement attendu (et documenté dans
  // services/spotify/authConfig.ts).
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        caller: {
          name: 'metro',
          bundler: 'metro',
          platform: 'ios',
          preserveEnvVars: true,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?@react-native|react-native|@expo|@expo-module|expo|@react-navigation|@unimodules|@expo/vector-icons|expo-modules-core|@testing-library|@shopify/react-native-skia)',
  ],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(png|jpg|jpeg|gif|svg)$': '<rootDir>/__mocks__/imageStub.ts',
    // Stockage local factice pour les suites (pas de module natif en test).
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
    // expo-constants : expoConfig mutable (client Spotify de test, URL…).
    '^expo-constants$': '<rootDir>/__mocks__/expo-constants.ts',
    // expo-clipboard (V24) : presse-papiers factice configurable par test.
    '^expo-clipboard$': '<rootDir>/__mocks__/expo-clipboard.ts',
    // netinfo (V31) : connectivité simulée « en ligne » par défaut.
    '^@react-native-community/netinfo$': '<rootDir>/__mocks__/netinfo.ts',
    '^@config$': '<rootDir>/config/index.ts',
    '^@api$': '<rootDir>/api/index.ts',
    // Alias présents dans tsconfig.json : sans eux, les suites qui chargent
    // un écran (via jest.requireActual('@components')) échouaient à
    // s'exécuter — « Cannot find module '@components' » — et ne testaient
    // donc RIEN (bibliothèque, titres aimés, playlists).
    '^@components$': '<rootDir>/components/index.ts',
    '^@navigators$': '<rootDir>/navigators/index.ts',
    '^@screens$': '<rootDir>/screens/index.ts',
    '^@models$': '<rootDir>/models/index.ts',
    '^@utils$': '<rootDir>/utils/index.ts',
    '^@data$': '<rootDir>/data/index.ts',
    '^@services$': '<rootDir>/services/index.ts',
    '^@context$': '<rootDir>/context/index.ts',
    '^@hooks$': '<rootDir>/hooks/index.ts',
    '^@assets/(.*)$': '<rootDir>/assets/$1',
  },
};
