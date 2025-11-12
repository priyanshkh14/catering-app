// ──────────────────────────────────────────────────────────────────────
// app/(tabs)/history.tsx
// ──────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, SectionList, Animated, TouchableOpacity } from 'react-native';
import { Text, Button, Divider, IconButton } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';

type Order = {
  id: string;
  clientName: string;
  mobile: string;
  address: string;
  dateTime: string; // "12/11/2025 at 3:30 PM"
  orderBlocks: { description: string; notes: string }[];
  quotationAmount: string;
  pdfUri: string;
};

type Section = {
  title: string;
  data: Order[];
  count: number;
};

export default function HistoryScreen() {
  const [sections, setSections] = useState<Section[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ────── Safe Date Parser (prevents Jan 1970) ──────
  const parseDate = (s?: string): Date => {
    if (!s) return new Date();
    const parts = s.split(' at ');
    if (parts.length !== 2) return new Date();
    const [datePart, timePart] = parts;
    const nums = datePart.split('/').map(Number);
    if (nums.length !== 3 || nums.some(isNaN)) return new Date();
    const [d, m, y] = nums;
    const timeMatch = timePart.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!timeMatch) return new Date();
    let [_, h, min, ampm] = timeMatch;
    let hour = parseInt(h);
    const minute = parseInt(min);
    if (isNaN(hour) || isNaN(minute)) return new Date();
    if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return new Date(y, m - 1, d, hour, minute);
  };

  // ────── Load + Migrate + Dedupe + Group Orders ──────
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('orders');
        if (!raw) return;

        let orders: any[] = JSON.parse(raw);

        // ---- 1. Keep only valid entries
        const valid: Order[] = orders
          .filter((o): o is Order => o && o.id && o.dateTime && o.pdfUri)
          .map(o => ({
            id: o.id,
            clientName: o.clientName ?? '',
            mobile: o.mobile ?? '',
            address: o.address ?? '',
            dateTime: o.dateTime,
            orderBlocks: Array.isArray(o.orderBlocks) ? o.orderBlocks : [],
            quotationAmount: o.quotationAmount ?? '0',
            pdfUri: o.pdfUri,
          }));

        // ---- 2. DEDUPLICATE (critical for key error)
        const seen = new Set<string>();
        const deduped: Order[] = [];
        for (const o of valid) {
          if (!seen.has(o.id)) {
            seen.add(o.id);
            deduped.push(o);
          }
        }

        // ---- 3. Persist cleaned data (once)
        if (deduped.length !== valid.length) {
          await AsyncStorage.setItem('orders', JSON.stringify(deduped));
        }

        // ---- 4. Sort newest first
        deduped.sort((a, b) => parseDate(b.dateTime).getTime() - parseDate(a.dateTime).getTime());

        // ---- 5. Group by month-year
        const groups: Record<string, Order[]> = {};
        deduped.forEach(o => {
          const dt = parseDate(o.dateTime);
          const key = `${dt.toLocaleString('default', { month: 'long' })} ${dt.getFullYear()}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push(o);
        });

        const sectionList: Section[] = Object.entries(groups).map(([title, data]) => ({
          title,
          data,
          count: data.length,
        }));

        setSections(sectionList);
      } catch (e) {
        console.error('History load failed:', e);
      }
    })();
  }, []);

  // ────── Toggle Expand ──────
  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ────── Share ONLY the PDF (no WhatsApp message) ──────
  const sharePDF = async (pdfUri: string) => {
    try {
      await Sharing.shareAsync(pdfUri, { mimeType: 'application/pdf' });
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        // Unique key: id + index to guarantee uniqueness even after dedupe
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              {section.title} ({section.count} quotation{section.count > 1 ? 's' : ''})
            </Text>
          </View>
        )}
        renderItem={({ item, index }) => {
          const isExpanded = expanded.has(item.id);
          return (
            <View style={styles.card}>
              {/* ── Compact Header ── */}
              <TouchableOpacity onPress={() => toggleExpand(item.id)} activeOpacity={0.7}>
                <View style={styles.headerRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="titleMedium" style={styles.idText}>
                      {item.id}
                    </Text>
                    <Text style={styles.clientText}>{item.clientName}</Text>
                    <Text style={styles.dateText}>{item.dateTime}</Text>
                    <Text style={styles.amountText}>
                      ₹{parseFloat(item.quotationAmount).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <IconButton
                    icon={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    style={{ margin: 0 }}
                  />
                </View>
              </TouchableOpacity>

              {/* ── Expandable Details ── */}
              {isExpanded && (
                <Animated.View style={styles.details}>
                  <Divider style={styles.divider} />
                  <Text style={styles.label}>Mobile: {item.mobile}</Text>
                  <Text style={styles.label}>Location: {item.address}</Text>

                  <Text style={[styles.label, { marginTop: 8, fontWeight: '600' }]}>
                    Menu:
                  </Text>
                  {item.orderBlocks.map((b, i) => (
                    <View key={i} style={styles.menuItem}>
                      <Text style={styles.menuTitle}>• Order {i + 1}:</Text>
                      <Text style={styles.menuDesc}>{b.description || '–'}</Text>
                      {b.notes ? (
                        <Text style={styles.menuNote}>Note: {b.notes}</Text>
                      ) : null}
                    </View>
                  ))}

                  <Button
                    mode="contained"
                    icon="file-pdf-box"
                    onPress={() => sharePDF(item.pdfUri)}
                    style={styles.shareBtn}
                    contentStyle={{ height: 44 }}
                  >
                    Share PDF
                  </Button>
                </Animated.View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>No quotations yet. Create one in the New Order tab!</Text>
        }
      />
    </View>
  );
}

// ────────────────────── Styles ──────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  sectionHeader: {
    backgroundColor: '#e9ecef',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: '#dee2e6',
  },
  sectionTitle: { fontWeight: '600', color: '#212529' },
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    elevation: 2,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  idText: { fontWeight: 'bold', color: '#ff6600' },
  clientText: { fontSize: 15, color: '#212529' },
  dateText: { fontSize: 13, color: '#6c757d', marginTop: 2 },
  amountText: { fontSize: 14, fontWeight: '600', color: '#212529', marginTop: 4 },
  details: { paddingHorizontal: 12, paddingBottom: 12 },
  divider: { marginVertical: 8 },
  label: { fontSize: 14, color: '#495057', marginBottom: 4 },
  menuItem: { marginLeft: 8, marginBottom: 8 },
  menuTitle: { fontWeight: '600', color: '#212529' },
  menuDesc: { marginLeft: 8, color: '#212529' },
  menuNote: { marginLeft: 8, fontStyle: 'italic', color: '#6c757d', fontSize: 13 },
  shareBtn: { marginTop: 12, backgroundColor: '#007BFF' }, // blue for PDF
  empty: { textAlign: 'center', marginTop: 40, fontSize: 16, color: '#6c757d' },
});