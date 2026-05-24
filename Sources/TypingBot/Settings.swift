import Foundation

struct Settings {
    var wpm: Int
    var lastText: String
    var typos: Bool
    var transpositions: Bool
    var variableSpeed: Bool
    var burstMode: Bool

    static let defaults = Settings(
        wpm: 60,
        lastText: "",
        typos: true,
        transpositions: true,
        variableSpeed: true,
        burstMode: true
    )
}

final class SettingsStore {
    private let ud: UserDefaults

    init() {
        self.ud = UserDefaults(suiteName: "com.typingbot.app") ?? .standard
    }

    func load() -> Settings {
        Settings(
            wpm:            ud.object(forKey: "wpm")            as? Int    ?? Settings.defaults.wpm,
            lastText:       ud.string(forKey: "lastText")                   ?? Settings.defaults.lastText,
            typos:          ud.object(forKey: "typos")          as? Bool   ?? Settings.defaults.typos,
            transpositions: ud.object(forKey: "transpositions") as? Bool   ?? Settings.defaults.transpositions,
            variableSpeed:  ud.object(forKey: "variableSpeed")  as? Bool   ?? Settings.defaults.variableSpeed,
            burstMode:      ud.object(forKey: "burstMode")       as? Bool   ?? Settings.defaults.burstMode
        )
    }

    func save(_ s: Settings) {
        ud.set(s.wpm,            forKey: "wpm")
        ud.set(s.lastText,       forKey: "lastText")
        ud.set(s.typos,          forKey: "typos")
        ud.set(s.transpositions, forKey: "transpositions")
        ud.set(s.variableSpeed,  forKey: "variableSpeed")
        ud.set(s.burstMode,      forKey: "burstMode")
    }
}
