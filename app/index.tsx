import React, { useState } from 'react';
import { ScrollView, View, StyleSheet, SafeAreaView } from 'react-native';
import {
  Text,
  Button,
  Input,
  Card,
  Chip,
  Badge,
  Divider,
  Avatar,
  colors,
  spacing,
  textStyles,
} from '@/design-system';

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="heading2" style={styles.sectionTitle}>{title}</Text>
      <Divider style={styles.divider} />
      {children}
    </View>
  );
}

function Row({ children, gap = spacing[2] }: { children: React.ReactNode; gap?: number }) {
  return <View style={[styles.row, { gap }]}>{children}</View>;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DesignSystemShowcase() {
  const [text, setText] = useState('');

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text variant="display1">Design System</Text>
          <Text variant="body1" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
            Toss SEED-inspired · Black Primary
          </Text>
        </View>

        {/* ── Typography ─────────────────────────────────────────── */}
        <Section title="Typography">
          {(Object.keys(textStyles) as Array<keyof typeof textStyles>).map((variant) => (
            <View key={variant} style={styles.typoRow}>
              <Text variant="caption1" color={colors.text.tertiary} style={styles.typoLabel}>
                {variant}
              </Text>
              <Text variant={variant}>{variant}</Text>
            </View>
          ))}
        </Section>

        {/* ── Colors ─────────────────────────────────────────────── */}
        <Section title="Colors">
          <Text variant="label1" color={colors.text.tertiary} style={{ marginBottom: spacing[2] }}>Text</Text>
          <Row>
            {(['primary','secondary','tertiary','disabled','hint'] as const).map((key) => (
              <View key={key} style={styles.colorSwatch}>
                <View style={[styles.swatchBox, { backgroundColor: colors.text[key] }]} />
                <Text variant="caption2" color={colors.text.tertiary}>{key}</Text>
              </View>
            ))}
          </Row>

          <Text variant="label1" color={colors.text.tertiary} style={[styles.colorGroupTitle]}>Semantic</Text>
          <Row>
            {(
              [
                { label: 'positive',    color: colors.positive.default    },
                { label: 'negative',    color: colors.negative.default    },
                { label: 'cautious',    color: colors.cautious.default    },
                { label: 'informative', color: colors.informative.default },
              ] as const
            ).map(({ label, color }) => (
              <View key={label} style={styles.colorSwatch}>
                <View style={[styles.swatchBox, { backgroundColor: color }]} />
                <Text variant="caption2" color={colors.text.tertiary}>{label}</Text>
              </View>
            ))}
          </Row>

          <Text variant="label1" color={colors.text.tertiary} style={styles.colorGroupTitle}>Market</Text>
          <Row>
            <View style={styles.colorSwatch}>
              <View style={[styles.swatchBox, { backgroundColor: colors.market.rise }]} />
              <Text variant="caption2" color={colors.text.tertiary}>rise</Text>
            </View>
            <View style={styles.colorSwatch}>
              <View style={[styles.swatchBox, { backgroundColor: colors.market.fall }]} />
              <Text variant="caption2" color={colors.text.tertiary}>fall</Text>
            </View>
            <View style={styles.colorSwatch}>
              <View style={[styles.swatchBox, { backgroundColor: colors.market.neutral }]} />
              <Text variant="caption2" color={colors.text.tertiary}>neutral</Text>
            </View>
          </Row>
        </Section>

        {/* ── Buttons ────────────────────────────────────────────── */}
        <Section title="Buttons">
          <Text variant="label1" color={colors.text.tertiary} style={styles.subLabel}>Variants</Text>
          <Row gap={spacing[2]}>
            <Button variant="primary"   size="md" label="Primary"   />
            <Button variant="secondary" size="md" label="Secondary" />
            <Button variant="outline"   size="md" label="Outline"   />
          </Row>
          <Row gap={spacing[2]} style={{ marginTop: spacing[2] }}>
            <Button variant="ghost"  size="md" label="Ghost"  />
            <Button variant="danger" size="md" label="Danger" />
          </Row>

          <Text variant="label1" color={colors.text.tertiary} style={styles.subLabel}>Sizes</Text>
          <Row gap={spacing[2]}>
            <Button variant="primary" size="sm" label="Small"  />
            <Button variant="primary" size="md" label="Medium" />
            <Button variant="primary" size="lg" label="Large"  />
          </Row>

          <Text variant="label1" color={colors.text.tertiary} style={styles.subLabel}>States</Text>
          <Row gap={spacing[2]}>
            <Button variant="primary" size="md" label="Loading" loading />
            <Button variant="primary" size="md" label="Disabled" disabled />
          </Row>
        </Section>

        {/* ── Inputs ─────────────────────────────────────────────── */}
        <Section title="Inputs">
          <Input
            label="코인 수량"
            placeholder="0.00"
            keyboardType="decimal-pad"
            hint="소수점 8자리까지 입력 가능합니다"
            value={text}
            onChangeText={setText}
          />
          <View style={{ marginTop: spacing[3] }}>
            <Input
              label="검색"
              placeholder="코인명 또는 심볼"
              variant="filled"
            />
          </View>
          <View style={{ marginTop: spacing[3] }}>
            <Input
              label="에러 상태"
              placeholder="입력값"
              error="올바른 값을 입력해주세요"
              variant="default"
            />
          </View>
        </Section>

        {/* ── Cards ──────────────────────────────────────────────── */}
        <Section title="Cards">
          <Card variant="elevated" style={{ marginBottom: spacing[3] }}>
            <Text variant="heading3">BTC / KRW</Text>
            <Text variant="numericLarge" style={{ marginTop: spacing[1] }}>₩ 98,450,000</Text>
            <Text variant="body2" color={colors.market.rise} style={{ marginTop: spacing[1] }}>
              +2.34%  ▲ 2,250,000
            </Text>
          </Card>
          <Row gap={spacing[3]}>
            <Card variant="outlined" style={{ flex: 1 }}>
              <Text variant="label2" color={colors.text.tertiary}>시가총액</Text>
              <Text variant="numericSmall" style={{ marginTop: spacing[1] }}>1,920조</Text>
            </Card>
            <Card variant="filled" style={{ flex: 1 }}>
              <Text variant="label2" color={colors.text.tertiary}>거래량 (24H)</Text>
              <Text variant="numericSmall" style={{ marginTop: spacing[1] }}>48,200 BTC</Text>
            </Card>
          </Row>
        </Section>

        {/* ── Chips ──────────────────────────────────────────────── */}
        <Section title="Chips">
          <Row gap={spacing[2]}>
            <Chip label="전체" variant="default" />
            <Chip label="BTC" selected />
            <Chip label="상승" variant="positive" />
            <Chip label="하락" variant="negative" />
            <Chip label="보합" variant="cautious" />
          </Row>
        </Section>

        {/* ── Badges ─────────────────────────────────────────────── */}
        <Section title="Badges">
          <Row gap={spacing[2]}>
            <Badge label="기본" variant="default" />
            <Badge label="상승" variant="positive" />
            <Badge label="하락" variant="negative" />
            <Badge label="주의" variant="cautious" />
            <Badge label="정보" variant="informative" />
          </Row>
          <Row gap={spacing[2]} style={{ marginTop: spacing[2] }}>
            <Badge label="Small"  size="sm" />
            <Badge label="Medium" size="md" />
            <Badge label="Large"  size="lg" />
          </Row>
        </Section>

        {/* ── Avatars ────────────────────────────────────────────── */}
        <Section title="Avatars">
          <Row gap={spacing[3]}>
            <Avatar size="xs" name="BTC" />
            <Avatar size="sm" name="ETH" />
            <Avatar size="md" name="XRP" />
            <Avatar size="lg" name="SOL" />
            <Avatar size="xl" name="ADA" />
          </Row>
        </Section>

        <View style={{ height: spacing[10] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: colors.bg.default,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing[5],
  },
  header: {
    paddingVertical: spacing[8],
  },
  section: {
    marginBottom: spacing[8],
  },
  sectionTitle: {
    marginBottom: spacing[3],
  },
  divider: {
    marginBottom: spacing[4],
  },
  subLabel: {
    marginTop:    spacing[3],
    marginBottom: spacing[2],
    color:        colors.text.tertiary,
  },
  row: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    alignItems:    'center',
  },
  typoRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  spacing[2],
    gap:           spacing[4],
  },
  typoLabel: {
    width: 80,
  },
  colorSwatch: {
    alignItems: 'center',
    gap:        spacing[1],
  },
  swatchBox: {
    width:        40,
    height:       40,
    borderRadius: 8,
    borderWidth:  1,
    borderColor:  colors.border.default,
  },
  colorGroupTitle: {
    marginTop:    spacing[4],
    marginBottom: spacing[2],
  },
});
