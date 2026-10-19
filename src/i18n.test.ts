import { describe, expect, it } from 'vitest';
import { serverText, t } from './i18n';

describe('serverText', () => {
  it('laat Nederlandse tekst ongemoeid in de Nederlandse interface', () => {
    expect(serverText('Langer dan 1 maand beschikbaar', 'nl')).toBe('Langer dan 1 maand beschikbaar');
  });

  it('vertaalt bewaartermijnen in enkelvoud en meervoud', () => {
    expect(serverText('Langer dan 1 maand en 30 dagen beschikbaar', 'en')).toBe('Available for more than 1 month and 30 days');
    expect(serverText('Langer dan 2 maanden en 1 dag beschikbaar', 'en')).toBe('Available for more than 2 months and 1 day');
    expect(serverText('Langer dan 1 maand beschikbaar', 'en')).toBe('Available for more than 1 month');
    expect(serverText('Langer dan 3 dagen beschikbaar', 'en')).toBe('Available for more than 3 days');
  });

  it('vertaalt servicefouten en samengestelde scan- en verwijdermeldingen', () => {
    expect(serverText('Radarr: films lezen mislukt (401). Controleer de API-key.', 'en')).toBe('Radarr: failed to read movies (401). Check the API key.');
    expect(serverText('36 verzoeken en seizoenen gecontroleerd. 2 Seerr-detailaanvragen overgeslagen; overige verzoeken zijn verwerkt. Automatisch: 1 verwijderd, 0 mislukt.', 'en'))
      .toBe('36 requests and seasons checked. 2 Seerr media detail requests skipped; remaining requests were processed. Automatic: 1 removed, 0 failed.');
    expect(serverText('Film, volledige map en Radarr-item verwijderd (id 1). Film, volledige map en Radarr-item verwijderd (id 2). Seerr-verzoek verwijderd.', 'en'))
      .toBe('Movie, complete folder and Radarr item removed (id 1). Movie, complete folder and Radarr item removed (id 2). Seerr request removed.');
  });

  it('vult plaatshouders in interfaceteksten', () => {
    expect(t('en', 'removeSelected', { count: 3 })).toBe('Remove selected (3)');
  });
});
