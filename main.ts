//  ==========================================
//  RFID RC522 + KITRONIK OLED
//  micro:bit V2 - MakeCode Python
// 
//  A = ZAPIS PAWEL
//  B = ZAPIS MICROBIT
//  KARTA = ODCZYT UID I DANYCH
// 
//  MIFARE CLASSIC 1K
//  BLOK 4
//  ==========================================
let BLOCK = 4
let last_uid = ""
let display_uid = ""
let display_data = ""
let display_time = 0
let display_page = 0
let busy = false
let card_seen = false
//  ==========================================
//  REJESTRY RC522
//  ==========================================
function write_reg(reg: number, value: number) {
    pins.digitalWritePin(DigitalPin.P16, 0)
    pins.spiWrite(reg << 1 & 0x7E)
    pins.spiWrite(value & 255)
    pins.digitalWritePin(DigitalPin.P16, 1)
}

function read_reg(reg: number): number {
    pins.digitalWritePin(DigitalPin.P16, 0)
    pins.spiWrite(reg << 1 & 0x7E | 0x80)
    let value = pins.spiWrite(0)
    pins.digitalWritePin(DigitalPin.P16, 1)
    return value
}

function set_bits(reg: number, mask: number) {
    write_reg(reg, read_reg(reg) | mask)
}

function clear_bits(reg: number, mask: number) {
    write_reg(reg, read_reg(reg) & (255 ^ mask))
}

//  ==========================================
//  INICJALIZACJA RC522
//  ==========================================
function rc522_init() {
    pins.digitalWritePin(DigitalPin.P16, 1)
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
}

//  ==========================================
//  TRANSMISJA RC522
//  ==========================================
function communicate(data: number[], last_bits: number): number[] {
    let i: number;
    let irq: number;
    write_reg(0x01, 0)
    write_reg(0x04, 0x7F)
    write_reg(0x0A, 0x80)
    for (i = 0; i < data.length; i++) {
        write_reg(0x09, data[i])
    }
    write_reg(0x0D, last_bits)
    write_reg(0x01, 0x0C)
    set_bits(0x0D, 0x80)
    let completed = false
    for (i = 0; i < 300; i++) {
        irq = read_reg(0x04)
        if ((irq & 0x30) != 0) {
            completed = true
            break
        }
        
        if ((irq & 0x01) != 0) {
            break
        }
        
        control.waitMicros(100)
    }
    clear_bits(0x0D, 0x80)
    if (!completed) {
        return []
    }
    
    if ((read_reg(0x06) & 0x13) != 0) {
        return []
    }
    
    let count = read_reg(0x0A)
    let result : number[] = []
    for (i = 0; i < count; i++) {
        result.push(read_reg(0x09))
    }
    return result
}

//  ==========================================
//  CRC_A
//  ==========================================
function crc_a(data: number[]): number[] {
    let i: number;
    write_reg(0x01, 0)
    write_reg(0x05, 0x04)
    write_reg(0x0A, 0x80)
    for (i = 0; i < data.length; i++) {
        write_reg(0x09, data[i])
    }
    write_reg(0x01, 0x03)
    let ready = false
    for (i = 0; i < 300; i++) {
        if ((read_reg(0x05) & 0x04) != 0) {
            ready = true
            break
        }
        
        control.waitMicros(100)
    }
    if (!ready) {
        return []
    }
    
    //  CRCResultRegL, CRCResultRegH
    return [read_reg(0x22), read_reg(0x21)]
}

//  ==========================================
//  HEX
//  ==========================================
function byte_to_hex(value: number): string {
    let digits = "0123456789ABCDEF"
    return digits.charAt(value >> 4 & 15) + digits.charAt(value & 15)
}

function uid_to_text(data: number[]): string {
    let result = ""
    for (let i = 0; i < data.length; i++) {
        result = result + byte_to_hex(data[i])
    }
    return result
}

//  ==========================================
//  ODCZYT UID
//  ==========================================
function get_uid(): number[] {
    let response = communicate([0x26], 7)
    if (response.length != 2) {
        return []
    }
    
    response = communicate([0x93, 0x20], 0)
    if (response.length != 5) {
        return []
    }
    
    let check = response[0] ^ response[1] ^ response[2] ^ response[3]
    if (check != response[4]) {
        return []
    }
    
    return [response[0], response[1], response[2], response[3]]
}

//  ==========================================
//  SELECT CARD
//  ==========================================
function select_card(uid: number[]): boolean {
    let data = [0x93, 0x70]
    for (let i = 0; i < 4; i++) {
        data.push(uid[i])
    }
    let bcc = uid[0] ^ uid[1] ^ uid[2] ^ uid[3]
    data.push(bcc)
    let crc = crc_a(data)
    if (crc.length != 2) {
        return false
    }
    
    data.push(crc[0])
    data.push(crc[1])
    let response = communicate(data, 0)
    return response.length == 3
}

//  ==========================================
//  AUTHENTICATION
//  ==========================================
function authenticate(uid: number[]): boolean {
    let i: number;
    let irq: number;
    let data = [0x60, BLOCK]
    for (i = 0; i < 6; i++) {
        data.push(255)
    }
    for (i = 0; i < 4; i++) {
        data.push(uid[i])
    }
    write_reg(0x01, 0)
    write_reg(0x04, 0x7F)
    write_reg(0x0A, 0x80)
    for (i = 0; i < data.length; i++) {
        write_reg(0x09, data[i])
    }
    write_reg(0x01, 0x0E)
    let success = false
    for (i = 0; i < 300; i++) {
        irq = read_reg(0x04)
        if ((irq & 0x10) != 0) {
            success = true
            break
        }
        
        if ((irq & 0x01) != 0) {
            break
        }
        
        control.waitMicros(100)
    }
    if (!success) {
        return false
    }
    
    return (read_reg(0x08) & 0x08) != 0
}

function stop_crypto() {
    clear_bits(0x08, 0x08)
}

//  ==========================================
//  READ BLOCK
//  ==========================================
function read_block(): number[] {
    let data = [0x30, BLOCK]
    let crc = crc_a(data)
    if (crc.length != 2) {
        return []
    }
    
    data.push(crc[0])
    data.push(crc[1])
    let response = communicate(data, 0)
    if (response.length != 18) {
        return []
    }
    
    let result : number[] = []
    for (let i = 0; i < 16; i++) {
        result.push(response[i])
    }
    return result
}

//  ==========================================
//  WRITE BLOCK
//  ==========================================
function write_block(data16: number[]): boolean {
    let command = [0xA0, BLOCK]
    let crc = crc_a(command)
    if (crc.length != 2) {
        return false
    }
    
    command.push(crc[0])
    command.push(crc[1])
    let response = communicate(command, 0)
    if (response.length != 1) {
        return false
    }
    
    if ((response[0] & 0x0F) != 0x0A) {
        return false
    }
    
    let data : number[] = []
    for (let i = 0; i < 16; i++) {
        data.push(data16[i])
    }
    crc = crc_a(data)
    if (crc.length != 2) {
        return false
    }
    
    data.push(crc[0])
    data.push(crc[1])
    response = communicate(data, 0)
    if (response.length != 1) {
        return false
    }
    
    return (response[0] & 0x0F) == 0x0A
}

//  ==========================================
//  TEXT <-> BYTES
//  ==========================================
function text_to_bytes(text: string): number[] {
    let result : number[] = []
    for (let i = 0; i < text.length; i++) {
        result.push(text.charCodeAt(i))
    }
    while (result.length < 16) {
        result.push(0)
    }
    return result
}

function bytes_to_text(data: number[]): string {
    let value: number;
    let result = ""
    for (let i = 0; i < data.length; i++) {
        value = data[i]
        if (value == 0) {
            break
        }
        
        if (value >= 32 && value <= 126) {
            result = result + String.fromCharCode(value)
        }
        
    }
    return result
}

//  ==========================================
//  OLED
//  ==========================================
function oled(text: string) {
    kitronik_VIEW128x64.clear()
    kitronik_VIEW128x64.show(text)
    kitronik_VIEW128x64.refresh()
}

//  ==========================================
//  PREPARE CARD
//  ==========================================
function prepare_card(): number[] {
    stop_crypto()
    let uid = get_uid()
    if (uid.length != 4) {
        return []
    }
    
    if (!select_card(uid)) {
        return []
    }
    
    if (!authenticate(uid)) {
        return []
    }
    
    return uid
}

//  ==========================================
//  ZAPIS
//  ==========================================
function save_text(text: string) {
    
    if (busy) {
        return
    }
    
    busy = true
    oled("ZAPIS...")
    let uid = prepare_card()
    if (uid.length != 4) {
        oled("BRAK AUTH")
        basic.pause(1000)
        busy = false
        return
    }
    
    let data = text_to_bytes(text)
    let success = write_block(data)
    stop_crypto()
    if (success) {
        oled("ZAPIS OK")
        basic.showIcon(IconNames.Yes)
        last_uid = ""
    } else {
        oled("BLAD ZAPISU")
        basic.showIcon(IconNames.No)
    }
    
    basic.pause(1200)
    basic.clearScreen()
    busy = false
}

//  ==========================================
//  PRZYCISKI
//  ==========================================
input.onButtonPressed(Button.A, function on_button_a() {
    save_text("PAWEL")
})
input.onButtonPressed(Button.B, function on_button_b() {
    save_text("MICROBIT")
})
//  ==========================================
//  START
//  ==========================================
pins.spiPins(DigitalPin.P14, DigitalPin.P15, DigitalPin.P13)
pins.spiFormat(8, 0)
pins.spiFrequency(1000000)
pins.digitalWritePin(DigitalPin.P16, 1)
rc522_init()
oled("PRZYLOZ KARTE")
basic.showIcon(IconNames.Diamond)
basic.pause(1000)
basic.clearScreen()
//  ==========================================
//  PETLA GLOWNA
//  ==========================================
basic.forever(function on_forever() {
    let uid_text: string;
    let data: number[];
    
    
    
    
    if (busy) {
        basic.pause(100)
        return
    }
    
    let uid = get_uid()
    if (uid.length == 4) {
        uid_text = uid_to_text(uid)
        if (uid_text != last_uid) {
            busy = true
            display_uid = uid_text
            display_data = "BRAK ODCZYTU"
            if (select_card(uid)) {
                if (authenticate(uid)) {
                    data = read_block()
                    stop_crypto()
                    if (data.length == 16) {
                        display_data = bytes_to_text(data)
                        if (display_data == "") {
                            display_data = "PUSTE"
                        }
                        
                    }
                    
                } else {
                    display_data = "BRAK AUTH"
                }
                
            }
            
            last_uid = uid_text
            display_page = 0
            display_time = input.runningTime()
            oled(display_uid)
            serial.writeLine("UID: " + display_uid)
            serial.writeLine("DANE: " + display_data)
            busy = false
        }
        
    }
    
    if (last_uid != "") {
        if (input.runningTime() - display_time > 2000) {
            display_time = input.runningTime()
            if (display_page == 0) {
                display_page = 1
                oled(display_data)
            } else {
                display_page = 0
                oled(display_uid)
            }
            
        }
        
    }
    
    basic.pause(200)
})
