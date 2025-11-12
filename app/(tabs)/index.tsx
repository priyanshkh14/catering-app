// ──────────────────────────────────────────────────────────────────────
// app/(tabs)/index.tsx
// ──────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  Linking,
  KeyboardAvoidingView,
  TouchableOpacity,
} from 'react-native';
import {
  TextInput,
  Button,
  Text,
  Divider,
  Snackbar,
  IconButton,
  Card,
} from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

type Client = { mobile: string; name: string; address: string; notes: string };
type OrderBlock = {
  id: string;
  description: string;
  notes: string;
  guests: string;
};

export default function OrderFormScreen() {
  const [orderId, setOrderId] = useState<string>('');
  const [clientName, setClientName] = useState<string>('');
  const [mobile, setMobile] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [showTimePicker, setShowTimePicker] = useState<boolean>(false);
  const [orderBlocks, setOrderBlocks] = useState<OrderBlock[]>([
    { id: '1', description: '', notes: '', guests: '' },
  ]);
  const [quotationAmount, setQuotationAmount] = useState<string>('');
  const [snackbarVisible, setSnackbarVisible] = useState<boolean>(false);
  const [snackbarMessage, setSnackbarMessage] = useState<string>('');
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [searchField, setSearchField] = useState<'name' | 'mobile'>('name');

  const scrollRef = useRef<ScrollView>(null);
  const BBN_DIR = `${FileSystem.documentDirectory}BBN_Quotations/`;

  // ── Helpers ───────────────────────────────────────────────────────
  const ensureFolder = async (): Promise<void> => {
    const info = await FileSystem.getInfoAsync(BBN_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(BBN_DIR, { intermediates: true });
  };

  const loadClients = async (): Promise<Client[]> => {
    try {
      const stored = await AsyncStorage.getItem('clients');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const saveClient = async (): Promise<void> => {
    if (!mobile || !clientName) return;
    const clients = await loadClients();
    const existing = clients.find((c: Client) => c.mobile === mobile);
    const newClient: Client = { mobile, name: clientName, address, notes: orderBlocks[0].notes };
    if (!existing) {
      clients.push(newClient);
    } else {
      Object.assign(existing, newClient);
    }
    await AsyncStorage.setItem('clients', JSON.stringify(clients));
  };

  // ── FIXED: generateOrderId ───────────────────────────────────────
  const generateOrderId = async (): Promise<string> => {
    if (!clientName || !date) return '';
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const base = `${clientName.toUpperCase().replace(/\s+/g, '')}${d}${m}${y}Q`;
    const stored = await AsyncStorage.getItem('orders');
    const orders = stored ? JSON.parse(stored) : [];
    const same = orders.filter((o: any) => o.id?.startsWith(base));
    const seq = String(same.length + 1).padStart(3, '0');
    return `${base}${seq}`;
  };

  // Update orderId when clientName or date changes
  useEffect(() => {
    generateOrderId().then(setOrderId);
  }, [clientName, date]); // ← FIXED: was date_LINE

  // ── Search Suggestions ───────────────────────────────────────────
  useEffect(() => {
    const query = searchField === 'name' ? clientName : mobile;
    if (query.length >= 2) {
      (async () => {
        const clients = await loadClients();
        const matches = clients.filter((c: Client) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.mobile.includes(query)
        );
        setClientSuggestions(matches.slice(0, 5));
        setShowSuggestions(matches.length > 0);
      })();
    } else {
      setShowSuggestions(false);
    }
  }, [clientName, mobile, searchField]);

  const selectClient = (client: Client): void => {
    setClientName(client.name);
    setMobile(client.mobile);
    setAddress(client.address);
    setShowSuggestions(false);
  };

  const onChangeDate = (_event: any, selected?: Date): void => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) setDate(selected);
  };

  const onChangeTime = (_event: any, selected?: Date): void => {
    setShowTimePicker(Platform.OS === 'ios');
    if (selected) setTime(selected);
  };

  const formatDateTime = (): string => {
    const d = date.toLocaleDateString('en-GB');
    const t = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${d} at ${t}`;
  };

  const addOrderBlock = (): void => {
    const newBlock: OrderBlock = { id: Date.now().toString(), description: '', notes: '', guests: '' };
    setOrderBlocks(prev => [...prev, newBlock]);
  };

  const updateBlock = (id: string, field: 'description' | 'notes' | 'guests', value: string): void => {
    setOrderBlocks(prev =>
      prev.map(b => (b.id === id ? { ...b, [field]: value } : b))
    );
  };

  const removeBlock = (id: string): void => {
    if (orderBlocks.length > 1) {
      setOrderBlocks(prev => prev.filter(b => b.id !== id));
    }
  };

  // ── PDF: MENU PRINTS + AUTO PAGE BREAK + FOOTER ON EVERY PAGE ─────
  const generateAndSavePDF = async (): Promise<{ finalUri: string } | null> => {
    if (!orderId || !clientName || !mobile || !address || !quotationAmount) {
      setSnackbarMessage('Fill all required fields.');
      setSnackbarVisible(true);
      return null;
    }
    if (mobile.length !== 10 || isNaN(Number(mobile))) {
      setSnackbarMessage('Mobile must be 10 digits.');
      setSnackbarVisible(true);
      return null;
    }
    if (orderBlocks.every(b => !b.description.trim())) {
      setSnackbarMessage('Add at least one menu item.');
      setSnackbarVisible(true);
      return null;
    }

    const menuHTML = orderBlocks
      .map((b, i) => `
        <div class="event-block" style="margin-bottom: 32px; font-size: 18px; page-break-inside: avoid;">
          <div style="font-size: 20px; font-weight: bold; margin-bottom: 8px;">Event ${i + 1}</div>
          <div><strong>Date:</strong> ${date.toLocaleDateString('en-GB')} &nbsp;&nbsp; <strong>Time:</strong> ${time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
          <div><strong>No. of Guests:</strong> ${b.guests || '–'}</div>
          <div style="margin-top: 8px;"><strong>Menu:</strong></div>
          <div style="margin-left: 16px; line-height: 1.7;">${b.description.replace(/\n/g, '<br>')}</div>
          ${b.notes ? `<div style="margin-top: 8px;"><strong>Notes:</strong></div><div style="margin-left: 16px; line-height: 1.7;">${b.notes}</div>` : ''}
        </div>`)
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page {
            size: A4;
            margin: 20mm 15mm 25mm 15mm;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 18px;
            color: #222;
            line-height: 1.6;
            margin: 0;
            padding: 0;
          }
          .header { text-align: center; margin-bottom: 25px; }
          .header h1 { font-size: 36px; color: #ff0000ff; margin: 0; }
          .header p { margin: 6px 0; font-size: 20px; font-weight: bold; }
          .hr { border-top: 3px dashed #ff0000ff; margin: 20px 0; }
          .info { margin-bottom: 16px; font-size: 19px; }
          .info strong { display: inline-block; width: 160px; font-weight: 600; }
          .total { font-weight: bold; font-size: 22px; margin: 30px 0; color: #ff0000ff; }
          .event-block { page-break-inside: avoid; margin-bottom: 32px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>B.B.N CATERERS</h1>
          <p>CATERERS | SWEETS | NAMKEEN | SNACKS</p>
          <p>PURE VEGETARIAN | INDOOR & OUTDOOR CATERING</p>
        </div>
        <div class="hr"></div>
        <p style="text-align:center; font-size:16px;">
          27, Channamal Park, East Punjabi Bagh, Near Ashoka Park Metro Station,<br>
          New Delhi-26  Phone: 9250928676 | 9540505607
        </p>

        <div style="margin-top:30px;">
          <div class="info"><strong>Client Name:</strong> ${clientName}</div>
          <div class="info"><strong>Mobile Number:</strong> ${mobile}</div>
          <div class="info"><strong>Event Location:</strong> ${address}</div>
        </div>

        <div style="margin-top:30px;">
          ${menuHTML}
        </div>

        <div style="margin-top:40px; font-size:19px;">
          <p>For the menu provided by you,<br>
          We'll be glad to cater you for <strong>Rs. ${parseFloat(quotationAmount).toLocaleString('en-IN')} (includes all hidden costs)</strong></p>
        </div>

        <div style="margin-top:30px; font-size:19px;">
          <p>Thank you</p>
          <p>Regards,<br><strong>Team B.B.N CATERERS</strong></p>
        </div>
        <div style="text-align: center; font-style: italic; font-size: 15px; color: #555; margin-top: 40px;">
          <p>WE LOOK FORWARD TO SERVE YOU FOR MANY MORE YEARS TO COME ...</p>
        </div>
      </body>
      </html>`;

    try {
      await ensureFolder();
      const { uri } = await Print.printToFileAsync({ html });
      const finalUri = `${BBN_DIR}${orderId}.pdf`;
      await FileSystem.copyAsync({ from: uri, to: finalUri });

      const order = {
        id: orderId,
        clientName,
        mobile,
        address,
        dateTime: formatDateTime(),
        orderBlocks,
        quotationAmount,
        pdfUri: finalUri,
      };
      const stored = await AsyncStorage.getItem('orders');
      const list = stored ? JSON.parse(stored) : [];
      list.push(order);
      await AsyncStorage.setItem('orders', JSON.stringify(list));
      await saveClient();

      return { finalUri };
    } catch (e) {
      console.error(e);
      setSnackbarMessage('Failed to generate PDF');
      setSnackbarVisible(true);
      return null;
    }
  };

  const sendMessageOnly = async (): Promise<void> => {
    if (!mobile) {
      setSnackbarMessage('Enter mobile number');
      setSnackbarVisible(true);
      return;
    }
    const url = `whatsapp://send?phone=91${mobile}&text=${encodeURIComponent(
      "Please review the menu and let us know if any further arrangements need to be done."
    )}`;
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
    setSnackbarMessage(can ? 'Message sent' : 'WhatsApp not installed');
    setSnackbarVisible(true);
  };

  const sendPDFOnly = async (): Promise<void> => {
    const result = await generateAndSavePDF();
    if (result) {
      await Sharing.shareAsync(result.finalUri, { mimeType: 'application/pdf' });
      setSnackbarMessage('PDF shared');
      setSnackbarVisible(true);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} style={styles.container} keyboardShouldPersistTaps="handled">

        <Text variant="headlineSmall" style={styles.header}>Client Details</Text>

        <TextInput label="Quotation ID (auto)" mode="outlined" value={orderId} disabled style={styles.input} />

        {/* CLIENT NAME */}
        <View style={{ position: 'relative' }}>
          <TextInput
            label="Client Name"
            mode="outlined"
            value={clientName}
            onChangeText={setClientName}
            onFocus={() => setSearchField('name')}
            style={styles.input}
          />
          {showSuggestions && searchField === 'name' && (
            <View style={styles.suggestionsBox}>
              {clientSuggestions.map((item: Client) => (
                <TouchableOpacity
                  key={item.mobile}
                  style={styles.suggestionItem}
                  onPress={() => selectClient(item)}
                >
                  <Text style={styles.suggestionName}>{item.name}</Text>
                  <Text style={styles.suggestionMobile}>{item.mobile}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* MOBILE */}
        <View style={{ position: 'relative' }}>
          <TextInput
            label="Mobile Number"
            mode="outlined"
            value={mobile}
            onChangeText={setMobile}
            keyboardType="phone-pad"
            onFocus={() => setSearchField('mobile')}
            style={styles.input}
          />
          {showSuggestions && searchField === 'mobile' && (
            <View style={styles.suggestionsBox}>
              {clientSuggestions.map((item: Client) => (
                <TouchableOpacity
                  key={item.mobile}
                  style={styles.suggestionItem}
                  onPress={() => selectClient(item)}
                >
                  <Text style={styles.suggestionName}>{item.name}</Text>
                  <Text style={styles.suggestionMobile}>{item.mobile}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <TextInput label="Event Location" mode="outlined" style={styles.input} multiline value={address} onChangeText={setAddress} />

        <View style={styles.dateTimeContainer}>
          <Button mode="outlined" onPress={() => setShowDatePicker(true)} style={styles.dateButton}>
            Date: {date.toLocaleDateString('en-GB')}
          </Button>
          {showDatePicker && <DateTimePicker value={date} mode="date" onChange={onChangeDate} />}
        </View>

        <View style={styles.dateTimeContainer}>
          <Button mode="outlined" onPress={() => setShowTimePicker(true)} style={styles.dateButton}>
            Time: {time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
          </Button>
          {showTimePicker && <DateTimePicker value={time} mode="time" onChange={onChangeTime} />}
        </View>

        <Divider style={styles.divider} />

        <Text variant="headlineSmall" style={styles.header}>Order Details</Text>

        {orderBlocks.map((block, idx) => (
          <Card key={block.id} style={styles.orderCard}>
            <TextInput
              label={`Menu Description ${idx + 1}`}
              mode="outlined"
              multiline
              value={block.description}
              onChangeText={t => updateBlock(block.id, 'description', t)}
              style={styles.input}
            />
            <TextInput
              label="No. of Guests"
              mode="outlined"
              keyboardType="numeric"
              value={block.guests}
              onChangeText={t => updateBlock(block.id, 'guests', t)}
              style={styles.input}
            />
            <TextInput
              label="Extra Notes"
              mode="outlined"
              multiline
              value={block.notes}
              onChangeText={t => updateBlock(block.id, 'notes', t)}
              style={styles.input}
            />
            {orderBlocks.length > 1 && (
              <IconButton icon="delete" size={20} onPress={() => removeBlock(block.id)} style={{ alignSelf: 'flex-end' }} />
            )}
          </Card>
        ))}

        <Button mode="outlined" icon="plus" onPress={addOrderBlock} style={styles.input}>
          Add Another Order
        </Button>

        <Divider style={styles.divider} />

        <Text variant="headlineSmall" style={styles.header}>Summary</Text>

        <TextInput
          label="Quotation Amount (Rs.)"
          mode="outlined"
          keyboardType="numeric"
          value={quotationAmount}
          onChangeText={setQuotationAmount}
          style={styles.input}
        />

        <View style={styles.buttonRow}>
          <Button mode="contained" icon="message" style={[styles.actionButton, { backgroundColor: '#25D366' }]} onPress={sendMessageOnly}>
            Send Message
          </Button>
          <Button mode="contained" icon="file-pdf-box" style={[styles.actionButton, { backgroundColor: '#007BFF' }]} onPress={sendPDFOnly}>
            Send PDF
          </Button>
        </View>

        <Snackbar
          visible={snackbarVisible}
          onDismiss={() => setSnackbarVisible(false)}
          duration={4000}
          style={{ backgroundColor: snackbarMessage.includes('saved') ? '#FF6B35' : '#51CF66' }}
        >
          <Text style={{ color: '#fff', fontWeight: '500' }}>{snackbarMessage}</Text>
        </Snackbar>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ── Styles ── */
const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#F8F9FA' },
  header: { marginBottom: 12, color: '#212529', fontWeight: '600' },
  input: { marginBottom: 12, backgroundColor: '#FFFFFF' },
  divider: { marginVertical: 16, backgroundColor: '#DEE2E6' },
  dateTimeContainer: { marginBottom: 12 },
  dateButton: { justifyContent: 'center', borderColor: '#DEE2E6' },
  orderCard: { padding: 12, marginBottom: 16, backgroundColor: '#FFFFFF', elevation: 1 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, marginBottom: 32 },
  actionButton: { flex: 1, marginHorizontal: 4, paddingVertical: 6 },

  suggestionsBox: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    elevation: 5,
    maxHeight: 180,
    zIndex: 10,
  },
  suggestionItem: { padding: 12, borderBottomWidth: 1, borderColor: '#eee' },
  suggestionName: { fontWeight: '600', color: '#212529' },
  suggestionMobile: { fontSize: 12, color: '#6C757D' },
});