# ==========================================
# RFID RC522 + KITRONIK OLED
# micro:bit V2 - MakeCode Python
#
# A = ZAPIS PAWEL
# B = ZAPIS MICROBIT
# KARTA = ODCZYT UID I DANYCH
#
# MIFARE CLASSIC 1K
# BLOK 4
# ==========================================

BLOCK = 4

last_uid = ""
display_uid = ""
display_data = ""
display_time = 0
display_page = 0
busy = False
card_seen = False


# ==========================================
# REJESTRY RC522
# ==========================================

def write_reg(reg: number, value: number):
    pins.digital_write_pin(DigitalPin.P16, 0)
    pins.spi_write((reg << 1) & 0x7E)
    pins.spi_write(value & 255)
    pins.digital_write_pin(DigitalPin.P16, 1)


def read_reg(reg: number) -> number:
    pins.digital_write_pin(DigitalPin.P16, 0)
    pins.spi_write(((reg << 1) & 0x7E) | 0x80)
    value = pins.spi_write(0)
    pins.digital_write_pin(DigitalPin.P16, 1)
    return value


def set_bits(reg: number, mask: number):
    write_reg(reg, read_reg(reg) | mask)


def clear_bits(reg: number, mask: number):
    write_reg(reg, read_reg(reg) & (255 ^ mask))


# ==========================================
# INICJALIZACJA RC522
# ==========================================

def rc522_init():
    pins.digital_write_pin(DigitalPin.P16, 1)
    basic.pause(100)

    write_reg(0x01, 0x0F)
    basic.pause(100)

    write_reg(0x2A, 0x80)
    write_reg(0x2B, 0xA9)
    write_reg(0x2C, 0x03)
    write_reg(0x2D, 0xE8)

    write_reg(0x15, 0x40)
    write_reg(0x11, 0x3D)

    set_bits(0x14, 0x03)


# ==========================================
# TRANSMISJA RC522
# ==========================================

def communicate(data: List[number], last_bits: number) -> List[number]:
    write_reg(0x01, 0)
    write_reg(0x04, 0x7F)
    write_reg(0x0A, 0x80)

    for i in range(len(data)):
        write_reg(0x09, data[i])

    write_reg(0x0D, last_bits)
    write_reg(0x01, 0x0C)
    set_bits(0x0D, 0x80)

    completed = False

    for i in range(300):
        irq = read_reg(0x04)

        if (irq & 0x30) != 0:
            completed = True
            break

        if (irq & 0x01) != 0:
            break

        control.wait_micros(100)

    clear_bits(0x0D, 0x80)

    if not completed:
        return []

    if (read_reg(0x06) & 0x13) != 0:
        return []

    count = read_reg(0x0A)
    result: List[number] = []

    for i in range(count):
        result.append(read_reg(0x09))

    return result


# ==========================================
# CRC_A
# ==========================================

def crc_a(data: List[number]) -> List[number]:
    write_reg(0x01, 0)
    write_reg(0x05, 0x04)
    write_reg(0x0A, 0x80)

    for i in range(len(data)):
        write_reg(0x09, data[i])

    write_reg(0x01, 0x03)

    ready = False

    for i in range(300):
        if (read_reg(0x05) & 0x04) != 0:
            ready = True
            break

        control.wait_micros(100)

    if not ready:
        return []

    # CRCResultRegL, CRCResultRegH
    return [read_reg(0x22), read_reg(0x21)]


# ==========================================
# HEX
# ==========================================

def byte_to_hex(value: number) -> str:
    digits = "0123456789ABCDEF"
    return digits.char_at((value >> 4) & 15) + digits.char_at(value & 15)


def uid_to_text(data: List[number]) -> str:
    result = ""

    for i in range(len(data)):
        result = result + byte_to_hex(data[i])

    return result


# ==========================================
# ODCZYT UID
# ==========================================

def get_uid() -> List[number]:
    response = communicate([0x26], 7)

    if len(response) != 2:
        return []

    response = communicate([0x93, 0x20], 0)

    if len(response) != 5:
        return []

    check = response[0] ^ response[1] ^ response[2] ^ response[3]

    if check != response[4]:
        return []

    return [
        response[0],
        response[1],
        response[2],
        response[3]
    ]


# ==========================================
# SELECT CARD
# ==========================================

def select_card(uid: List[number]) -> bool:
    data: List[number] = [0x93, 0x70]

    for i in range(4):
        data.append(uid[i])

    bcc = uid[0] ^ uid[1] ^ uid[2] ^ uid[3]
    data.append(bcc)

    crc = crc_a(data)

    if len(crc) != 2:
        return False

    data.append(crc[0])
    data.append(crc[1])

    response = communicate(data, 0)

    return len(response) == 3


# ==========================================
# AUTHENTICATION
# ==========================================

def authenticate(uid: List[number]) -> bool:
    data: List[number] = [0x60, BLOCK]

    for i in range(6):
        data.append(255)

    for i in range(4):
        data.append(uid[i])

    write_reg(0x01, 0)
    write_reg(0x04, 0x7F)
    write_reg(0x0A, 0x80)

    for i in range(len(data)):
        write_reg(0x09, data[i])

    write_reg(0x01, 0x0E)

    success = False

    for i in range(300):
        irq = read_reg(0x04)

        if (irq & 0x10) != 0:
            success = True
            break

        if (irq & 0x01) != 0:
            break

        control.wait_micros(100)

    if not success:
        return False

    return (read_reg(0x08) & 0x08) != 0


def stop_crypto():
    clear_bits(0x08, 0x08)


# ==========================================
# READ BLOCK
# ==========================================

def read_block() -> List[number]:
    data: List[number] = [0x30, BLOCK]

    crc = crc_a(data)

    if len(crc) != 2:
        return []

    data.append(crc[0])
    data.append(crc[1])

    response = communicate(data, 0)

    if len(response) != 18:
        return []

    result: List[number] = []

    for i in range(16):
        result.append(response[i])

    return result


# ==========================================
# WRITE BLOCK
# ==========================================

def write_block(data16: List[number]) -> bool:
    command: List[number] = [0xA0, BLOCK]

    crc = crc_a(command)

    if len(crc) != 2:
        return False

    command.append(crc[0])
    command.append(crc[1])

    response = communicate(command, 0)

    if len(response) != 1:
        return False

    if (response[0] & 0x0F) != 0x0A:
        return False

    data: List[number] = []

    for i in range(16):
        data.append(data16[i])

    crc = crc_a(data)

    if len(crc) != 2:
        return False

    data.append(crc[0])
    data.append(crc[1])

    response = communicate(data, 0)

    if len(response) != 1:
        return False

    return (response[0] & 0x0F) == 0x0A


# ==========================================
# TEXT <-> BYTES
# ==========================================

def text_to_bytes(text: str) -> List[number]:
    result: List[number] = []

    for i in range(len(text)):
        result.append(text.char_code_at(i))

    while len(result) < 16:
        result.append(0)

    return result


def bytes_to_text(data: List[number]) -> str:
    result = ""

    for i in range(len(data)):
        value = data[i]

        if value == 0:
            break

        if value >= 32 and value <= 126:
            result = result + String.from_char_code(value)

    return result


# ==========================================
# OLED
# ==========================================

def oled(text: str):
    kitronik_VIEW128x64.clear()
    kitronik_VIEW128x64.show(text)
    kitronik_VIEW128x64.refresh()


# ==========================================
# PREPARE CARD
# ==========================================

def prepare_card() -> List[number]:
    stop_crypto()

    uid = get_uid()

    if len(uid) != 4:
        return []

    if not select_card(uid):
        return []

    if not authenticate(uid):
        return []

    return uid


# ==========================================
# ZAPIS
# ==========================================

def save_text(text: str):
    global busy, last_uid

    if busy:
        return

    busy = True

    oled("ZAPIS...")

    uid = prepare_card()

    if len(uid) != 4:
        oled("BRAK AUTH")
        basic.pause(1000)
        busy = False
        return

    data = text_to_bytes(text)

    success = write_block(data)
    stop_crypto()

    if success:
        oled("ZAPIS OK")
        basic.show_icon(IconNames.YES)
        last_uid = ""
    else:
        oled("BLAD ZAPISU")
        basic.show_icon(IconNames.NO)

    basic.pause(1200)
    basic.clear_screen()
    busy = False


# ==========================================
# PRZYCISKI
# ==========================================

def on_button_a():
    save_text("PAWEL")


def on_button_b():
    save_text("MICROBIT")


input.on_button_pressed(Button.A, on_button_a)
input.on_button_pressed(Button.B, on_button_b)


# ==========================================
# START
# ==========================================

pins.spi_pins(
    DigitalPin.P14,
    DigitalPin.P15,
    DigitalPin.P13
)

pins.spi_format(8, 0)
pins.spi_frequency(1000000)

pins.digital_write_pin(DigitalPin.P16, 1)

rc522_init()

oled("PRZYLOZ KARTE")

basic.show_icon(IconNames.DIAMOND)

basic.pause(1000)
basic.clear_screen()


# ==========================================
# PETLA GLOWNA
# ==========================================

def on_forever():
    global last_uid
    global display_uid, display_data
    global display_time, display_page
    global busy, card_seen

    if busy:
        basic.pause(100)
        return

    uid = get_uid()

    if len(uid) == 4:
        uid_text = uid_to_text(uid)

        if uid_text != last_uid:
            busy = True

            display_uid = uid_text
            display_data = "BRAK ODCZYTU"

            if select_card(uid):
                if authenticate(uid):
                    data = read_block()
                    stop_crypto()

                    if len(data) == 16:
                        display_data = bytes_to_text(data)

                        if display_data == "":
                            display_data = "PUSTE"
                else:
                    display_data = "BRAK AUTH"

            last_uid = uid_text
            display_page = 0
            display_time = input.running_time()

            oled(display_uid)

            serial.write_line("UID: " + display_uid)
            serial.write_line("DANE: " + display_data)

            busy = False

    if last_uid != "":
        if input.running_time() - display_time > 2000:
            display_time = input.running_time()

            if display_page == 0:
                display_page = 1
                oled(display_data)
            else:
                display_page = 0
                oled(display_uid)

    basic.pause(200)


basic.forever(on_forever)