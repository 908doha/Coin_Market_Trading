import { Redirect } from 'expo-router';

// 토큰 체크 후 분기 (현재는 온보딩으로)
export default function Index() {
  return <Redirect href="/onboarding" />;
}
