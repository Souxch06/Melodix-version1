import * as React from 'react';
import { useRouter } from 'expo-router';

import { Slider } from '../../Slider';

import { getUserTopArtists } from '@api';
import { LibraryItemModel } from '@models';
import { Shapes, Sizes } from '@config';
import { translations } from '@data';

export type TopArtistsPropsType = {};

export const TopArtists = () => {
  const router = useRouter();
  const [topArtists, setTopArtists] = React.useState<LibraryItemModel[] | null>(
    [
      ...Array(3).fill({
        id: '',
        type: 'artist',
        title: '',
        imageURL: '',
        subtitle: '',
      }),
    ]
  );

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const topArtistsData = await getUserTopArtists();
        if (mounted) setTopArtists(topArtistsData);
      } catch (error) {
        if (mounted) {
          setTopArtists(null);
          console.error(error);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Hidden when Spotify refuses the request (e.g. missing permission).
  if (!topArtists?.length) {
    return null;
  }

  return (
    <Slider
      title={translations.yourTopArtists(topArtists.length)}
      slides={topArtists}
      size={Sizes.MEDIUM}
      shape={Shapes.CIRCLE}
      withShowAll={true}
      // Les identifiants d'artistes sont LOCAUX et synthétiques
      // (`local-artist:<nom>`) : aucune page artiste ne peut les résoudre.
      // « Tout afficher » ouvre donc l'HISTORIQUE, la source réelle de cet
      // agrégat — jamais une page morte.
      onShowAllPress={() => router.push('/home/history')}
      // Contrat (M-6) : pas de page artiste dans l'application — les cartes
      // sont donc EXPLICITEMENT inertes (no-op), jamais une navigation vers
      // une route stub /artist/{id}. À retirer le jour où la page existe.
      onSlidePress={() => undefined}
    />
  );
};
