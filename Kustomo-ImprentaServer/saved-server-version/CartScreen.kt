package com.ksprintexpress.fitfusion

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.HorizontalDivider
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.google.firebase.Timestamp
import com.google.firebase.auth.ktx.auth
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import com.ksprintexpress.fitfusion.ui.theme.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog

// ── Cart Screen ──
@Composable
fun CartScreen(
    onBackClick: () -> Unit = {},
    onBrowseProducts: () -> Unit = {},
    onCheckoutClick: () -> Unit = {},
    onEditDesign: (CartItem, Int) -> Unit = { _, _ -> }
) {
    val items = cartItems
    var selectedCartItemForDetails by remember { mutableStateOf<CartItem?>(null) }

    val subtotal = items.sumOf { it.product.price * it.quantity }
    // Fee and free-shipping amount come from the admin site's Shop Settings
    val shipping = ShopSettings.shippingFor(subtotal)
    val total = subtotal + shipping

    if (items.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().background(BlackFF),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = "🛒", fontSize = 64.sp)
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Your cart is empty",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.White
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Add some items to get started!",
                    fontSize = 14.sp,
                    color = Color(0xFF555555)
                )
                Spacer(modifier = Modifier.height(28.dp))
                GradientButton(
                    text = "Browse Products",
                    onClick = onBrowseProducts
                )
            }
        }
        return
    }

    Scaffold(containerColor = BlackFF) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 120.dp)
        ) {

            // Header
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onBackClick) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = Color.White
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Column {
                        Text(
                            text = "MY CART",
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Black,
                            color = Color.White,
                            letterSpacing = 3.sp
                        )
                        Text(
                            text = "${items.size} item${if (items.size != 1) "s" else ""}",
                            fontSize = 13.sp,
                            color = Color(0xFF555555)
                        )
                    }
                }
            }

            // Cart Items
            itemsIndexed(items) { index, item ->
                CartItemRow(
                    item = item,
                    onRemove = { cartItems.removeAt(index) },
                    onIncrease = { cartItems[index] = item.copy(quantity = item.quantity + 1) },
                    onDecrease = {
                        if (item.quantity > 1) cartItems[index] = item.copy(quantity = item.quantity - 1)
                    },
                    onEditDesign = { onEditDesign(item, index) },
                    onItemClick = { selectedCartItemForDetails = item }
                )
            }

            // Free shipping notice
            item {
                val remaining = ShopSettings.untilFreeShipping(subtotal)
                if (remaining != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 8.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFF1A1A1A))
                            .border(1.dp, Color(0xFF2E2E2E), RoundedCornerShape(10.dp))
                            .padding(14.dp)
                    ) {
                        Text(
                            text = "🚚  Add ${pesoText(kotlin.math.ceil(remaining))} more for FREE shipping!",
                            fontSize = 13.sp,
                            color = YellowFF
                        )
                    }
                } else if (ShopSettings.freeShippingMin > 0 && shipping == 0.0) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 8.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFF0A1A0A))
                            .border(1.dp, Color(0xFF1A3A1A), RoundedCornerShape(10.dp))
                            .padding(14.dp)
                    ) {
                        Text(
                            text = "🎉  You've unlocked FREE shipping!",
                            fontSize = 13.sp,
                            color = Color(0xFF00E676)
                        )
                    }
                }
            }

            // Order Summary
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF161616))
                        .padding(18.dp)
                ) {
                    Text(
                        text = "Order Summary",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White,
                        modifier = Modifier.padding(bottom = 14.dp)
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Subtotal", fontSize = 14.sp, color = Color(0xFF888888))
                        Text(
                            "₱${subtotal.toInt()}",
                            fontSize = 14.sp,
                            color = Color.White
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Shipping", fontSize = 14.sp, color = Color(0xFF888888))
                        Text(
                            if (shipping == 0.0) "FREE" else "₱${shipping.toInt()}",
                            fontSize = 14.sp,
                            color = if (shipping == 0.0) Color(0xFF00E676) else Color.White
                        )
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(Color(0xFF2E2E2E))
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            "Total",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Black,
                            color = Color.White
                        )
                        Text(
                            "₱${total.toInt()}",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black,
                            color = OrangeFF
                        )
                    }
                }
            }

            // Checkout Button
            item {
                Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                    GradientButton(
                        text = "Proceed to Checkout  →",
                        onClick = onCheckoutClick
                    )
                }
            }
        }

        if (selectedCartItemForDetails != null) {
            ItemSpecificationDialog(
                item = selectedCartItemForDetails!!,
                onDismiss = { selectedCartItemForDetails = null }
            )
        }
    }
}

@Composable
fun ItemSpecificationDialog(
    item: CartItem,
    onDismiss: () -> Unit
) {
    val notes = item.notes ?: ""
    val marker = "[Scanned Measurements - "

    // Parse AR Measurements vs Custom Notes
    val arIndex = notes.indexOf(marker)

    val customerNotes: String
    val arMeasurements: String

    if (arIndex != -1) {
        customerNotes = notes.substring(0, arIndex).trim()
        val arEnd = notes.indexOf("]", arIndex)
        arMeasurements = if (arEnd != -1) {
            notes.substring(arIndex + marker.length, arEnd).trim()
        } else {
            notes.substring(arIndex + marker.length).trim()
        }
    } else {
        customerNotes = notes.trim()
        arMeasurements = ""
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF1A1A1A),
        title = {
            Text(
                item.product.name,
                fontSize = 18.sp,
                fontWeight = FontWeight.Black,
                color = Color.White
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Section 1: Garment Details
                Column {
                    Text("Garment Details", fontSize = 11.sp, color = Color.Gray, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(6.dp))
                    Text("Category: ${item.product.category}", fontSize = 13.sp, color = Color.White)
                    Text("Size: ${item.size}", fontSize = 13.sp, color = Color.White)
                    if (item.customText.isNotEmpty()) {
                        Text("Print: \"${item.customText}\"", fontSize = 13.sp, color = OrangeFF)
                    }
                }

                // Section 2: App Created Notes (AR Scanning)
                if (arMeasurements.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFF0F1A13))
                            .border(0.5.dp, Color(0xFF00FF88).copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                            .padding(12.dp)
                    ) {
                        Text("📏 APP CREATED NOTES (AR SCANNING)",
                            fontSize = 10.sp, color = Color(0xFF00FF88), fontWeight = FontWeight.Black)
                        Spacer(modifier = Modifier.height(8.dp))

                        val metrics = arMeasurements.split(", ")
                        metrics.forEach { metric ->
                            Text("• $metric", fontSize = 12.sp, color = Color(0xFFDDDDDD))
                        }
                    }
                }

                // Section 3: Customer Specific Notes
                if (customerNotes.isNotEmpty() && customerNotes != "AR Scanned Fit") {
                    Column {
                        Text("📝 CUSTOMER SPECIFIC NOTES", fontSize = 11.sp, color = Color.Gray, fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(customerNotes, fontSize = 13.sp, color = Color.White)
                    }
                } else {
                    Column {
                        Text("📝 CUSTOMER SPECIFIC NOTES", fontSize = 11.sp, color = Color.Gray, fontWeight = FontWeight.Bold)
                        Spacer(modifier = Modifier.height(6.dp))
                        Text("No additional tailoring instructions provided.", fontSize = 12.sp, color = Color(0xFF555555), fontStyle = FontStyle.Italic)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close", color = OrangeFF, fontWeight = FontWeight.Bold)
            }
        }
    )
}

// ── Cart Item Row ──
@Composable
fun CartItemRow(
    item: CartItem,
    onRemove: () -> Unit,
    onIncrease: () -> Unit,
    onDecrease: () -> Unit,
    onEditDesign: () -> Unit = {},
    onItemClick: () -> Unit = {}
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF161616))
            .clickable { onItemClick() }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Product image placeholder
        Box(
            modifier = Modifier
                .size(70.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(
                    Brush.linearGradient(
                        colors = listOf(Color(0xFF1A1A1A), Color(0xFF0F0F0F))
                    )
                ),
            contentAlignment = Alignment.Center
        ) {
            val designImage = item.customization?.views?.get("Front")?.imageUri
            when {
                item.product.imageUrl.isNotBlank() -> AsyncImage(
                    model = item.product.imageUrl,
                    contentDescription = item.product.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
                designImage != null -> AsyncImage(
                    model = designImage,
                    contentDescription = item.product.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit
                )
                else -> Text(text = "👕", fontSize = 32.sp)
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.product.name,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(modifier = Modifier.height(3.dp))
            Text(
                text = "Size: ${item.size}",
                fontSize = 12.sp,
                color = Color(0xFF666666)
            )
            if (item.customText.isNotEmpty()) {
                Text(
                    text = "\"${item.customText}\"",
                    fontSize = 11.sp,
                    color = OrangeFF,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (item.customization != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Edit Design ✏️",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = OrangeFF,
                    modifier = Modifier.clickable { onEditDesign() }
                )
            }
            if (!item.notes.isNullOrEmpty()) {
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "📏 AR Measurements Attached",
                    fontSize = 10.sp,
                    color = Color(0xFF00FF88),
                    fontStyle = FontStyle.Italic
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Decrease
                Box(
                    modifier = Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF2A2A2A))
                        .clickable { onDecrease() },
                    contentAlignment = Alignment.Center
                ) {
                    Text("−", fontSize = 14.sp, color = Color.White, fontWeight = FontWeight.Bold)
                }
                Text(
                    text = item.quantity.toString(),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                // Increase
                Box(
                    modifier = Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(OrangeFF)
                        .clickable { onIncrease() },
                    contentAlignment = Alignment.Center
                ) {
                    Text("+", fontSize = 14.sp, color = Color.White, fontWeight = FontWeight.Bold)
                }
            }
        }

        Column(horizontalAlignment = Alignment.End) {
            IconButton(onClick = onRemove, modifier = Modifier.size(28.dp)) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = "Remove",
                    tint = Color(0xFF555555),
                    modifier = Modifier.size(18.dp)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "₱${(item.product.price * item.quantity).toInt()}",
                fontSize = 15.sp,
                fontWeight = FontWeight.Black,
                color = OrangeFF
            )
        }
    }
}

// ── Checkout Screen ──
@Composable
fun CheckoutScreen(
    onBackClick: () -> Unit = {},
    onOrderPlaced: (orderId: String, chatId: String) -> Unit = { _, _ -> }
) {
    val scope = rememberCoroutineScope()
    var fullName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var zipCode by remember { mutableStateOf("") }
    var barangay by remember { mutableStateOf("") }
    var landmark by remember { mutableStateOf("") }
    // The map pin that goes with the street typed above; dropped as soon as the street is retyped
    var pinLat by remember { mutableStateOf<Double?>(null) }
    var pinLng by remember { mutableStateOf<Double?>(null) }
    var barangayError by remember { mutableStateOf("") }
    var saveAddressToProfile by remember { mutableStateOf(true) }
    var fullNameError by remember { mutableStateOf("") }
    var phoneError by remember { mutableStateOf("") }
    var addressError by remember { mutableStateOf("") }
    var cityError by remember { mutableStateOf("") }
    var showConfirmDialog by remember { mutableStateOf(false) }
    var isPlacingOrder by remember { mutableStateOf(false) }
    var awaitingPayment by remember { mutableStateOf(false) }
    var orderError by remember { mutableStateOf("") }
    var cartProblem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { ProductRepository.start() }
    // Wake the payment server (it sleeps when unused) while the customer is still looking at the cart
    LaunchedEffect(Unit) { PayMongoService.wakeServer() }
    var useDownpayment by remember { mutableStateOf(false) }
    val context = LocalContext.current

    // Saved address (from Firestore users/{uid})
    var savedFirstName by remember { mutableStateOf("") }
    var savedLastName by remember { mutableStateOf("") }
    var savedPhone by remember { mutableStateOf("") }
    var savedStreet by remember { mutableStateOf("") }
    var savedCity by remember { mutableStateOf("") }
    var savedZip by remember { mutableStateOf("") }
    var savedBarangay by remember { mutableStateOf("") }
    var savedLandmark by remember { mutableStateOf("") }
    var savedLat by remember { mutableStateOf<Double?>(null) }
    var savedLng by remember { mutableStateOf<Double?>(null) }
    var hasSavedAddress by remember { mutableStateOf(false) }
    var useSavedAddress by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        val uid = Firebase.auth.currentUser?.uid ?: return@LaunchedEffect
        try {
            val snap = Firebase.firestore.collection("users")
                .document(uid).get().await()
            val d = snap.data ?: return@LaunchedEffect
            savedFirstName = d["firstName"] as? String ?: ""
            savedLastName = d["lastName"] as? String ?: ""
            savedPhone = d["phone"] as? String ?: ""
            savedStreet = d["streetAddress"] as? String ?: ""
            savedCity = d["city"] as? String ?: ""
            savedZip = d["zipCode"] as? String ?: ""
            savedBarangay = d["barangay"] as? String ?: ""
            savedLandmark = d["landmark"] as? String ?: ""
            savedLat = (d["addressLat"] as? Number)?.toDouble()
            savedLng = (d["addressLng"] as? Number)?.toDouble()
            hasSavedAddress = savedStreet.isNotBlank() && savedCity.isNotBlank()
            if (hasSavedAddress && useSavedAddress) {
                fullName = "$savedFirstName $savedLastName".trim()
                phone = savedPhone
                address = savedStreet
                city = savedCity
                zipCode = savedZip
                barangay = savedBarangay
                landmark = savedLandmark
                pinLat = savedLat
                pinLng = savedLng
            }
        } catch (_: Exception) { /* ignore — fall back to manual entry */ }
    }

    // ── Observe PayMongo payment result delivered by MainActivity.onNewIntent ──
    val pmResult = PayMongoState.paymentResult.value
    LaunchedEffect(pmResult) {
        val result = pmResult ?: return@LaunchedEffect
        when (result) {
            PayMongoState.PaymentResult.SUCCESS -> {
                val pending  = PayMongoState.pendingOrder  ?: return@LaunchedEffect
                val srcId    = PayMongoState.sourceId      ?: return@LaunchedEffect
                val centavos = PayMongoState.paymentAmountCentavos

                awaitingPayment = false
                isPlacingOrder  = true
                orderError      = ""

                try {
                    // Capture the payment on PayMongo
                    PayMongoService.createPayment(
                        sourceId        = srcId,
                        amountCentavos  = centavos,
                        description     = "FitFusion Order — ${pending.fullName}"
                    )

                    val (orderId, chatId) = OrderService.saveOrder(pending, srcId)

                    PayMongoState.reset()
                    showConfirmDialog = false
                    cartItems.clear()
                    onOrderPlaced(orderId, chatId)

                } catch (e: Exception) {
                    orderError     = "Payment received but order save failed.\nContact support. Ref: $srcId"
                    isPlacingOrder = false
                    PayMongoState.reset()
                }
            }

            PayMongoState.PaymentResult.FAILED -> {
                orderError      = "GCash payment was not completed. Please try again."
                awaitingPayment = false
                isPlacingOrder  = false
                PayMongoState.reset()
            }
        }
    }

    // True when what is typed isn't what the profile already holds, so saving it would change something
    val addressDiffersFromSaved = address.trim() != savedStreet || barangay.trim() != savedBarangay ||
        landmark.trim() != savedLandmark || city.trim() != savedCity || zipCode.trim() != savedZip ||
        pinLat != savedLat || pinLng != savedLng

    val subtotal = cartItems.sumOf { it.product.price * it.quantity }
    val shipping = ShopSettings.shippingFor(subtotal)
    val total = subtotal + shipping
    val totalItems = cartItems.sumOf { it.quantity }
    // Share and minimum cart size set on the admin site's Shop Settings
    val canDownpay = ShopSettings.offersDownpayment(totalItems)
    LaunchedEffect(canDownpay) { if (!canDownpay) useDownpayment = false }
    // Whole pesos, so what the customer reads is exactly what GCash charges
    val downpaymentAmount = kotlin.math.round(total * ShopSettings.downpaymentFraction)
    val remainingAmount = total - downpaymentAmount
    fun validate(): Boolean {
        var valid = true
        fullNameError = ""; phoneError = ""; addressError = ""; cityError = ""; barangayError = ""
        if (barangay.isBlank()) { barangayError = "Barangay is required."; valid = false }
        if (fullName.isBlank()) { fullNameError = "Full name is required."; valid = false }
        if (phone.isBlank() || phone.length != 11) { phoneError = "Phone number must be exactly 11 digits."; valid = false }
        if (address.isBlank()) { addressError = "Delivery address is required."; valid = false }
        if (city.isBlank()) { cityError = "City is required."; valid = false }
        return valid
    }

    // Confirm Dialog
    if (showConfirmDialog) {
        Dialog(onDismissRequest = { showConfirmDialog = false }) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color(0xFF1A1A1A))
                    .padding(24.dp)
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(text = "📦", fontSize = 44.sp)
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Confirm Order?",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    if (useDownpayment) {
                        Text(
                            text = "Downpayment: ₱${downpaymentAmount.toInt()}",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Black,
                            color = OrangeFF
                        )
                        Text(
                            text = "Remaining on delivery: ₱${remainingAmount.toInt()}",
                            fontSize = 12.sp,
                            color = Color(0xFF888888),
                            modifier = Modifier.padding(top = 2.dp)
                        )
                    } else {
                        Text(
                            text = "Total: ₱${total.toInt()}",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Black,
                            color = OrangeFF
                        )
                    }
                    Text(
                        text = "Payment via GCash",
                        fontSize = 13.sp,
                        color = Color(0xFF888888),
                        modifier = Modifier.padding(top = 4.dp)
                    )
                    Spacer(modifier = Modifier.height(20.dp))
                    if (orderError.isNotEmpty()) {
                            Text(orderError, color = PinkFF, fontSize = 12.sp,
                                modifier = androidx.compose.ui.Modifier.padding(bottom = 8.dp))
                        }
                    when {
                        // ── State 1: creating source or capturing payment ──
                        isPlacingOrder -> {
                            androidx.compose.material3.CircularProgressIndicator(
                                color = OrangeFF,
                                modifier = androidx.compose.ui.Modifier.size(40.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Processing payment…",
                                fontSize = 12.sp,
                                color = Color(0xFF888888)
                            )
                        }

                        // ── State 2: Chrome Custom Tab is open, waiting for GCash ──
                        awaitingPayment -> {
                            Text(text = "📱", fontSize = 36.sp)
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Complete payment in GCash,\nthen tap the button below.",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                textAlign = TextAlign.Center
                            )
                            Spacer(modifier = Modifier.height(14.dp))

                            // ── "I've Completed Payment" — checks source status ──
                            GradientButton(
                                text = "✅  I've Completed Payment",
                                onClick = {
                                    awaitingPayment = false
                                    isPlacingOrder  = true
                                    orderError      = ""
                                    scope.launch {
                                        try {
                                            val srcId    = PayMongoState.sourceId ?: throw Exception("Missing source ID")
                                            val centavos = PayMongoState.paymentAmountCentavos
                                            val pending  = PayMongoState.pendingOrder ?: throw Exception("Missing order data")

                                            // Check if GCash authorised the payment
                                            val status = PayMongoService.retrieveSource(srcId)
                                            if (status != "chargeable") {
                                                orderError     = "Payment not confirmed yet (status: $status).\nPlease complete the GCash payment first."
                                                isPlacingOrder = false
                                                awaitingPayment = true
                                                return@launch
                                            }

                                            // Capture the payment
                                            PayMongoService.createPayment(
                                                sourceId       = srcId,
                                                amountCentavos = centavos,
                                                description    = "FitFusion Order — ${pending.fullName}"
                                            )

                                            val (orderId, chatId) = OrderService.saveOrder(pending, srcId)

                                            PayMongoState.reset()
                                            showConfirmDialog = false
                                            cartItems.clear()
                                            onOrderPlaced(orderId, chatId)

                                        } catch (e: Exception) {
                                            orderError     = e.message ?: e.toString()
                                            isPlacingOrder = false
                                            awaitingPayment = true
                                        }
                                    }
                                }
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(44.dp)
                                    .clip(RoundedCornerShape(50))
                                    .border(1.dp, Color(0xFF3E1E1E), RoundedCornerShape(50))
                                    .clickable {
                                        awaitingPayment = false
                                        PayMongoState.reset()
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Text("Cancel Payment", fontSize = 14.sp, color = Color(0xFFFF4444))
                            }
                        }

                        // ── State 3: idle — show the Pay button ──
                        else -> {
                            GradientButton(
                                text = if (useDownpayment)
                                    "Pay with GCash  ₱${downpaymentAmount.toInt()}"
                                else
                                    "Pay with GCash  ₱${total.toInt()}",
                                onClick = {
                                    isPlacingOrder = true
                                    orderError = ""
                                    scope.launch {
                                        try {
                                            val uid = Firebase.auth.currentUser?.uid
                                                ?: throw Exception("Please sign in again to place your order.")
                                            val amountToPay =
                                                if (useDownpayment) downpaymentAmount else total
                                            val centavos = (amountToPay * 100).toLong()

                                            // Step 0 — upload any locally picked design images so the shop can see them.
                                            // Written back to the cart so a retry doesn't upload them again.
                                            cartItems.indices.forEach { i ->
                                                val custom = cartItems[i].customization ?: return@forEach
                                                cartItems[i] = cartItems[i].copy(
                                                    customization = DesignUploader.uploadLocalImages(custom, uid)
                                                )
                                            }

                                            // Step 1 — Create GCash source
                                            val source = PayMongoService.createGCashSource(
                                                amountCentavos = centavos,
                                                successUrl = "https://paymongo.com",
                                                failedUrl  = "https://paymongo.com"
                                            )

                                            // Keep the address for next time, if asked. Never worth failing the order over.
                                            if (saveAddressToProfile && addressDiffersFromSaved) {
                                                try {
                                                    AddressService.saveToProfile(
                                                        address, barangay, landmark, city, zipCode, pinLat, pinLng
                                                    )
                                                } catch (_: Exception) { }
                                            }

                                            // Stash order data until payment confirms
                                            PayMongoState.pendingOrder = PayMongoState.PendingOrderData(
                                                userId          = uid,
                                                fullName        = fullName.trim(),
                                                phone           = phone.trim(),
                                                streetAddress   = address.trim(),
                                                city            = city.trim(),
                                                zipCode         = zipCode.trim(),
                                                barangay        = barangay.trim(),
                                                landmark        = landmark.trim(),
                                                addressLat      = pinLat,
                                                addressLng      = pinLng,
                                                subtotal        = subtotal,
                                                shippingFee     = shipping,
                                                totalAmount     = total,
                                                isDownpayment   = useDownpayment,
                                                downpaymentAmount = if (useDownpayment) downpaymentAmount else 0.0,
                                                remainingAmount   = if (useDownpayment) remainingAmount   else 0.0,
                                                items = cartItems.map { it.toOrderMap() }
                                            )
                                            PayMongoState.sourceId = source.id
                                            PayMongoState.paymentAmountCentavos = centavos

                                            // Step 2 — Open GCash checkout in Chrome Custom Tab
                                            val tabIntent = CustomTabsIntent.Builder()
                                                .setShowTitle(true)
                                                .build()
                                            tabIntent.launchUrl(
                                                context,
                                                Uri.parse(source.checkoutUrl)
                                            )

                                            isPlacingOrder  = false
                                            awaitingPayment = true

                                        } catch (e: Exception) {
                                            orderError     = e.message ?: e.toString()
                                            isPlacingOrder = false
                                        }
                                    }
                                }
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(44.dp)
                                    .clip(RoundedCornerShape(50))
                                    .border(1.dp, Color(0xFF2E2E2E), RoundedCornerShape(50))
                                    .clickable { showConfirmDialog = false },
                                contentAlignment = Alignment.Center
                            ) {
                                Text("Cancel", fontSize = 14.sp, color = Color(0xFF666666))
                            }
                        }
                    }
                }
            }
        }
    }

    Scaffold(containerColor = BlackFF) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(bottom = 40.dp)
        ) {

            // Header
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "CHECKOUT",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White,
                        letterSpacing = 3.sp
                    )
                }
            }

            // Delivery Details Section
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF161616))
                        .padding(18.dp)
                ) {
                    Text(
                        text = "🏠  Delivery Details",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White,
                        modifier = Modifier.padding(bottom = 14.dp)
                    )

                    // Saved-address picker (only if user has one on file)
                    if (hasSavedAddress) {
                        Row(
                            modifier = Modifier.fillMaxWidth()
                                .padding(bottom = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            // Saved option
                            Box(
                                modifier = Modifier.weight(1f)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(
                                        if (useSavedAddress) Color(0xFF1A0A00)
                                        else Color(0xFF1A1A1A)
                                    )
                                    .border(
                                        1.dp,
                                        if (useSavedAddress) OrangeFF
                                        else Color(0xFF2A2A2A),
                                        RoundedCornerShape(10.dp)
                                    )
                                    .clickable {
                                        useSavedAddress = true
                                        fullName = "$savedFirstName $savedLastName".trim()
                                        phone = savedPhone
                                        address = savedStreet
                                        city = savedCity
                                        zipCode = savedZip
                                        barangay = savedBarangay
                                        landmark = savedLandmark
                                        pinLat = savedLat
                                        pinLng = savedLng
                                        fullNameError = ""; phoneError = ""
                                        addressError = ""; cityError = ""; barangayError = ""
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                Column {
                                    Text("📍 Saved Address",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = if (useSavedAddress) OrangeFF else Color.White)
                                    Text(savedStreet,
                                        fontSize = 11.sp,
                                        color = Color(0xFF888888),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis)
                                }
                            }
                            // New address option
                            Box(
                                modifier = Modifier.weight(1f)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(
                                        if (!useSavedAddress) Color(0xFF1A0A00)
                                        else Color(0xFF1A1A1A)
                                    )
                                    .border(
                                        1.dp,
                                        if (!useSavedAddress) OrangeFF
                                        else Color(0xFF2A2A2A),
                                        RoundedCornerShape(10.dp)
                                    )
                                    .clickable {
                                        useSavedAddress = false
                                        fullName = ""; phone = ""
                                        address = ""; city = ""; zipCode = ""
                                        barangay = ""; landmark = ""
                                        pinLat = null; pinLng = null
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                Column {
                                    Text("✏️ New Address",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = if (!useSavedAddress) OrangeFF else Color.White)
                                    Text("Type, search or use the map",
                                        fontSize = 11.sp,
                                        color = Color(0xFF888888))
                                }
                            }
                        }
                    }

                    CheckoutTextField(
                        value = fullName,
                        onValueChange = { fullName = it; fullNameError = "" },
                        label = "FULL NAME",
                        placeholder = "Name ng Customer",
                        errorMessage = fullNameError
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    CheckoutTextField(
                        value = phone,
                        onValueChange = { input ->
                            val digits = input.filter { it.isDigit() }
                            if (digits.length <= 11) { phone = digits; phoneError = "" }
                        },
                        label = "PHONE NUMBER (11 digits)",
                        placeholder = "09XXXXXXXXX",
                        errorMessage = phoneError,
                        maxLength = 11
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    AddressAutoCompleteField(
                        value = address,
                        // Retyping the street means the old pin no longer belongs to it
                        onValueChange = { address = it; addressError = ""; pinLat = null; pinLng = null },
                        onAddressSelected = { picked ->
                            address = picked.street
                            if (picked.city.isNotEmpty()) { city = picked.city; cityError = "" }
                            if (picked.zipCode.isNotEmpty()) zipCode = picked.zipCode
                            if (picked.barangay.isNotEmpty()) { barangay = picked.barangay; barangayError = "" }
                            pinLat = picked.lat
                            pinLng = picked.lng
                            addressError = ""
                        },
                        errorMessage = addressError,
                        pinLat = pinLat,
                        pinLng = pinLng,
                        onPinChanged = { lat, lng -> pinLat = lat; pinLng = lng }
                    )
                    if (pinLat == null) {
                        Text(
                            "Tip: tap the pin button to mark the exact spot on a map.",
                            fontSize = 11.sp, color = Color(0xFF666666),
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    CheckoutTextField(
                        value = barangay,
                        onValueChange = { barangay = it; barangayError = "" },
                        label = "BARANGAY",
                        placeholder = "Barangay 123 / Bagong Silang",
                        errorMessage = barangayError
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    CheckoutTextField(
                        value = landmark,
                        onValueChange = { landmark = it },
                        label = "LANDMARK (OPTIONAL)",
                        placeholder = "Near the covered court, blue gate",
                        errorMessage = ""
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Box(modifier = Modifier.weight(2f)) {
                            CheckoutTextField(
                                value = city,
                                onValueChange = { city = it; cityError = "" },
                                label = "CITY",
                                placeholder = "Manila",
                                errorMessage = cityError
                            )
                        }
                        Box(modifier = Modifier.weight(1f)) {
                            CheckoutTextField(
                                value = zipCode,
                                onValueChange = { zipCode = it },
                                label = "ZIP CODE",
                                placeholder = "1000",
                                errorMessage = ""
                            )
                        }
                    }
                    // Offer to remember the address whenever it isn't the one already on the profile
                    if (addressDiffersFromSaved) {
                        Spacer(modifier = Modifier.height(14.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { saveAddressToProfile = !saveAddressToProfile }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(22.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (saveAddressToProfile) OrangeFF else Color.Transparent)
                                    .border(
                                        1.5.dp,
                                        if (saveAddressToProfile) OrangeFF else Color(0xFF555555),
                                        RoundedCornerShape(6.dp)
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                if (saveAddressToProfile) {
                                    Text("✓", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White)
                                }
                            }
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                if (hasSavedAddress) "Replace my saved address with this one"
                                else "Save this address to my profile",
                                fontSize = 13.sp, color = Color.White
                            )
                        }
                    }
                }
            }

            item {
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Payment Method Section
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF161616))
                        .padding(18.dp)
                ) {
                    Text(
                        text = "💳  Payment Method",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White,
                        modifier = Modifier.padding(bottom = 14.dp)
                    )

                    // GCash — only payment method
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFF1A0A00))
                            .border(1.dp, OrangeFF, RoundedCornerShape(10.dp))
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF007AFF).copy(alpha = 0.15f)),
                            contentAlignment = Alignment.Center
                        ) { Text("📱", fontSize = 20.sp) }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("GCash", fontSize = 15.sp,
                                fontWeight = FontWeight.Bold, color = Color.White)
                            Text("Mobile wallet payment",
                                fontSize = 11.sp, color = Color(0xFF666666))
                        }
                        Box(
                            modifier = Modifier
                                .size(20.dp)
                                .clip(CircleShape)
                                .background(OrangeFF),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Check,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }

                    // Downpayment option — only for carts the shop's settings allow it on
                    if (canDownpay) {
                        Spacer(modifier = Modifier.height(14.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (useDownpayment) Color(0xFF0D1A0D)
                                    else Color(0xFF1A1A1A)
                                )
                                .border(
                                    1.dp,
                                    if (useDownpayment) Color(0xFF00E676) else Color(0xFF2A2A2A),
                                    RoundedCornerShape(10.dp)
                                )
                                .clickable { useDownpayment = !useDownpayment }
                                .padding(horizontal = 14.dp, vertical = 12.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .size(40.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color(0xFF00E676).copy(alpha = 0.10f)),
                                    contentAlignment = Alignment.Center
                                ) { Text("💰", fontSize = 20.sp) }
                                Spacer(modifier = Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text("Downpayment (${ShopSettings.downpaymentPercent}%)", fontSize = 14.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = if (useDownpayment) Color(0xFF00E676) else Color.White)
                                        Box(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(50))
                                                .background(OrangeFF)
                                                .padding(horizontal = 6.dp, vertical = 2.dp)
                                        ) {
                                            Text("${ShopSettings.downpaymentMinItems}+ items", fontSize = 9.sp,
                                                fontWeight = FontWeight.Bold, color = Color.White)
                                        }
                                    }
                                    Text(
                                        text = if (useDownpayment)
                                            "Pay ₱${downpaymentAmount.toInt()} now · ₱${remainingAmount.toInt()} on delivery"
                                        else
                                            "Pay ${ShopSettings.downpaymentPercent}% now, rest on delivery/pickup",
                                        fontSize = 11.sp,
                                        color = if (useDownpayment) Color(0xFF00E676).copy(alpha = 0.7f)
                                               else Color(0xFF666666)
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Switch(
                                    checked = useDownpayment,
                                    onCheckedChange = { useDownpayment = it },
                                    colors = SwitchDefaults.colors(
                                        checkedThumbColor = Color.White,
                                        checkedTrackColor = Color(0xFF00E676),
                                        uncheckedThumbColor = Color(0xFF555555),
                                        uncheckedTrackColor = Color(0xFF2A2A2A)
                                    )
                                )
                            }
                        }
                    }
                }
            }

            // Order Summary
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF161616))
                        .padding(18.dp)
                ) {
                    Text(
                        text = "🧾  Order Summary",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                        color = Color.White,
                        modifier = Modifier.padding(bottom = 14.dp)
                    )
                    cartItems.forEach { item ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "${item.product.name} ×${item.quantity}",
                                fontSize = 13.sp,
                                color = Color(0xFF888888),
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "₱${(item.product.price * item.quantity).toInt()}",
                                fontSize = 13.sp,
                                color = Color.White
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Color(0xFF2E2E2E)))
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Subtotal", fontSize = 14.sp, color = Color(0xFF888888))
                        Text("₱${subtotal.toInt()}", fontSize = 14.sp, color = Color.White)
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Shipping", fontSize = 14.sp, color = Color(0xFF888888))
                        Text(
                            if (shipping == 0.0) "FREE" else "₱${shipping.toInt()}",
                            fontSize = 14.sp,
                            color = if (shipping == 0.0) Color(0xFF00E676) else Color.White
                        )
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Color(0xFF2E2E2E)))
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            "Total",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Black,
                            color = Color.White
                        )
                        Text(
                            "₱${total.toInt()}",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black,
                            color = OrangeFF
                        )
                    }
                }
            }

            // Place Order Button
            item {
                Spacer(modifier = Modifier.height(20.dp))
                Column(modifier = Modifier.padding(horizontal = 20.dp)) {
                    cartProblem?.let { problem ->
                        Text(
                            problem, color = Color.White, fontSize = 13.sp,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(PinkFF.copy(alpha = 0.16f))
                                .padding(12.dp)
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                    }
                    GradientButton(
                        text = "Place Order  ₱${total.toInt()}",
                        onClick = {
                            // Products can be removed, switched off or sell out while they sit in a cart
                            cartProblem = ProductRepository.cartProblem(cartItems)
                            if (validate() && cartProblem == null) showConfirmDialog = true
                        }
                    )
                }
            }
        }
    }
}

// ── Order Success Screen ──
@Composable
fun OrderSuccessScreen(
    orderId: String,
    chatId: String = "",
    onContinueShopping: () -> Unit = {},
    onViewChat: (chatId: String) -> Unit = {}
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(BlackFF),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 32.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(90.dp)
                    .clip(CircleShape)
                    .background(Color(0x2200E676)),
                contentAlignment = Alignment.Center
            ) {
                Text(text = "✓", fontSize = 44.sp, color = Color(0xFF00E676))
            }
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "ORDER PLACED!",
                fontSize = 32.sp,
                fontWeight = FontWeight.Black,
                color = Color.White,
                letterSpacing = 3.sp
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "Your order has been successfully placed.\nWe'll start processing it right away!",
                fontSize = 14.sp,
                color = Color(0xFF666666),
                textAlign = TextAlign.Center,
                lineHeight = 22.sp
            )
            Spacer(modifier = Modifier.height(24.dp))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFF161616))
                    .border(1.dp, Color(0xFF2E2E2E), RoundedCornerShape(12.dp))
                    .padding(horizontal = 24.dp, vertical = 14.dp)
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "Order ID",
                        fontSize = 12.sp,
                        color = Color(0xFF555555),
                        letterSpacing = 1.sp
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = displayOrderId(orderId),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Black,
                        color = OrangeFF,
                        letterSpacing = 2.sp
                    )
                }
            }
            Spacer(modifier = Modifier.height(32.dp))
            GradientButton(
                text = "Continue Shopping",
                onClick = onContinueShopping
            )
            if (chatId.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .clip(RoundedCornerShape(50))
                        .border(1.dp, OrangeFF.copy(alpha = 0.5f), RoundedCornerShape(50))
                        .clickable { onViewChat(chatId) },
                    contentAlignment = Alignment.Center
                ) {
                    Text("💬  Message the Shop", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = OrangeFF)
                }
            }
        }
    }
}

// ── Reusable Checkout Text Field ──
@Composable
fun CheckoutTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String,
    errorMessage: String = "",
    maxLength: Int = Int.MAX_VALUE
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF888888),
                letterSpacing = 1.sp
            )
            // Show digit counter only when maxLength is set
            if (maxLength < Int.MAX_VALUE) {
                Text(
                    text = "${value.length}/$maxLength",
                    fontSize = 11.sp,
                    color = if (value.length == maxLength) OrangeFF else Color(0xFF555555)
                )
            }
        }
        Spacer(modifier = Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = { if (it.length <= maxLength) onValueChange(it) },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(placeholder, color = Color(0xFF3D3D3D), fontSize = 13.sp) },
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = if (errorMessage.isNotEmpty())
                    PinkFF else Color(0xFF2E2E2E),
                focusedBorderColor = if (errorMessage.isNotEmpty())
                    PinkFF else OrangeFF,
                unfocusedContainerColor = Color(0xFF1A1A1A),
                focusedContainerColor = Color(0xFF1A1A1A),
                unfocusedTextColor = Color.White,
                focusedTextColor = Color.White
            ),
            shape = RoundedCornerShape(10.dp)
        )
        if (errorMessage.isNotEmpty()) {
            Text(
                text = errorMessage,
                color = PinkFF,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 3.dp)
            )
        }
    }
}