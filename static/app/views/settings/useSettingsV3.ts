import {NODE_ENV} from 'sentry/constants';
import {useOrganization} from 'sentry/utils/useOrganization';

export function useSettingsV3(): boolean {
  const organization = useOrganization({allowNull: true});
  // Temporarily enable the settings v3 preview in local frontend development.
  return Boolean(
    organization &&
    (NODE_ENV === 'development' || organization.features.includes('settings-v3'))
  );
}
