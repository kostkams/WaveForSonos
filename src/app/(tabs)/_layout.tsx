import { Tabs } from 'expo-router/tabs';

import { NavBar } from '@/components/NavBar';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <NavBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="queue" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="speakers" />
    </Tabs>
  );
}
