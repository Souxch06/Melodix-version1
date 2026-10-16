import * as React from 'react';

import { Search } from '@components';

export type SearchScreenProps = {
  /** Auto-focus du champ à l'ouverture (navigation depuis la loupe). */
  autoFocus?: boolean;
};

export const SearchScreen = ({ autoFocus = false }: SearchScreenProps) => {
  return <Search autoFocus={autoFocus} />;
};
