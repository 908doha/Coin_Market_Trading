import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';

export default function PositionDetailRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useEffect(() => {
    router.replace(`/history/${id}?type=position`);
  }, [id]);
  return null;
}
